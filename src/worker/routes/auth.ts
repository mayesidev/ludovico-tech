import { type Hono } from "hono";
import {
  createCodeVerifier,
  createSessionId,
  createState,
  getAllowedEmails,
  getAuthenticatedUser,
  getRuntimeConfig,
  isDevelopmentAuth,
  isSecureEnvironment,
  newId,
  now,
  sessionIdFromRequest,
  sessionCookie,
  sha256Base64Url,
  type AppEnv,
} from "../env";

const googleJson = async (
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown> | null> => {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    const value = (await response.json()) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const normalizeReturnTo = (value: string | undefined): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const base = "https://ludovico-tech.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
};

export const registerAuthRoutes = (app: Hono<AppEnv>) => {
  app.get("/auth/me", async (c) => {
    c.header("Cache-Control", "no-store");
    const user = await getAuthenticatedUser(c.env, c.req.raw);
    return c.json({
      authenticated: Boolean(user),
      user: user ? { email: user.email, displayName: user.displayName } : null,
      local: isDevelopmentAuth(c.env),
    });
  });

  app.get("/auth/google", async (c) => {
    if (isDevelopmentAuth(c.env)) return c.redirect("/");
    if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_REDIRECT_URI) {
      return c.text("Google OAuth is not configured", 503);
    }

    const state = createState();
    const verifier = createCodeVerifier();
    const challenge = await sha256Base64Url(verifier);
    const createdAt = now();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const returnTo = normalizeReturnTo(c.req.query("returnTo"));

    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(
        createdAt,
      ),
      c.env.DB.prepare(
        "INSERT INTO oauth_states (state, code_verifier, created_at, expires_at, return_to) VALUES (?, ?, ?, ?, ?)",
      ).bind(state, verifier, createdAt, expiresAt, returnTo),
    ]);

    const params = new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: c.env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "online",
      prompt: "select_account",
    });

    return c.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
  });

  app.get("/auth/google/callback", async (c) => {
    if (isDevelopmentAuth(c.env)) return c.redirect("/");
    c.header("Cache-Control", "no-store");

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (
      !state ||
      !c.env.GOOGLE_CLIENT_ID ||
      !c.env.GOOGLE_CLIENT_SECRET ||
      !c.env.GOOGLE_REDIRECT_URI
    ) {
      return c.text("Invalid OAuth callback", 400);
    }

    const oauthState = await c.env.DB.prepare(
      `DELETE FROM oauth_states
       WHERE state = ? AND expires_at > ?
       RETURNING code_verifier, return_to`,
    )
      .bind(state, now())
      .first<{ code_verifier: string; return_to: string }>();
    if (!oauthState) {
      return c.text("OAuth state expired", 400);
    }
    if (!code) return c.text("Invalid OAuth callback", 400);

    const tokens = await googleJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: oauthState.code_verifier,
        grant_type: "authorization_code",
        redirect_uri: c.env.GOOGLE_REDIRECT_URI,
      }),
    });
    const accessToken = tokens?.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      return c.text("Authentication provider unavailable", 502);
    }

    const profile = await googleJson(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    if (!profile) return c.text("Authentication provider unavailable", 502);

    const email =
      typeof profile.email === "string"
        ? profile.email.trim().toLowerCase()
        : null;
    if (
      typeof profile.sub !== "string" ||
      !profile.sub ||
      !email ||
      profile.email_verified !== true ||
      !getAllowedEmails(c.env).has(email)
    ) {
      return c.text("This account is not on the invite list", 403);
    }

    const timestamp = now();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`,
    )
      .bind(
        newId(),
        email,
        typeof profile.name === "string"
          ? profile.name.trim().slice(0, 200) || email
          : email,
        timestamp,
        timestamp,
      )
      .run();
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    if (!user) return c.text("Unable to create user session", 500);

    const sessionId = createSessionId();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(
        timestamp,
      ),
      c.env.DB.prepare(
        "INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).bind(
        sessionId,
        user.id,
        timestamp,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      ),
    ]);
    const config = getRuntimeConfig(c.env);
    c.header(
      "Set-Cookie",
      sessionCookie(sessionId, isSecureEnvironment(config.environment)),
    );
    return c.redirect(oauthState.return_to);
  });

  app.post("/auth/logout", async (c) => {
    const sessionId = sessionIdFromRequest(c.req.raw);
    if (sessionId) {
      await c.env.DB.prepare("DELETE FROM auth_sessions WHERE id = ?")
        .bind(sessionId)
        .run();
    }
    const config = getRuntimeConfig(c.env);
    c.header(
      "Set-Cookie",
      sessionCookie("", isSecureEnvironment(config.environment), 0),
    );
    return c.json({ ok: true });
  });
};
