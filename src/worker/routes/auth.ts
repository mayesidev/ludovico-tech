import { type Hono } from "hono";
import {
  createCodeVerifier,
  createSessionId,
  createState,
  getActor,
  isLocal,
  newId,
  now,
  sessionCookie,
  sha256Base64Url,
  type AppEnv,
} from "../env";

export const registerAuthRoutes = (app: Hono<AppEnv>) => {
  app.get("/auth/me", async (c) => {
    const actor = await getActor(c.env, c.req.raw);
    return c.json({
      authenticated: Boolean(actor),
      actor: actor
        ? { email: actor.email, displayName: actor.displayName }
        : null,
      local: isLocal(c.env),
    });
  });

  app.get("/auth/google", async (c) => {
    if (isLocal(c.env)) return c.redirect("/");
    if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_REDIRECT_URI) {
      return c.text("Google OAuth is not configured", 503);
    }

    const state = createState();
    const verifier = createCodeVerifier();
    const challenge = await sha256Base64Url(verifier);
    const createdAt = now();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await c.env.DB.prepare(
      "INSERT INTO oauth_states (state, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
      .bind(state, verifier, createdAt, expiresAt)
      .run();

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
    if (isLocal(c.env)) return c.redirect("/");

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (
      !code ||
      !state ||
      !c.env.GOOGLE_CLIENT_ID ||
      !c.env.GOOGLE_CLIENT_SECRET ||
      !c.env.GOOGLE_REDIRECT_URI
    ) {
      return c.text("Invalid OAuth callback", 400);
    }

    const oauthState = await c.env.DB.prepare(
      "SELECT * FROM oauth_states WHERE state = ?",
    )
      .bind(state)
      .first<{ state: string; code_verifier: string; expires_at: string }>();
    await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ?")
      .bind(state)
      .run();
    if (!oauthState || oauthState.expires_at <= now()) {
      return c.text("OAuth state expired", 400);
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: c.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: oauthState.code_verifier,
      }),
    });
    if (!tokenResponse.ok) return c.text("Google token exchange failed", 502);

    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokens.access_token) {
      return c.text("Google token exchange returned no access token", 502);
    }

    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!profileResponse.ok) return c.text("Google profile lookup failed", 502);

    const profile = (await profileResponse.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    const email = profile.email?.toLowerCase();
    const allowedEmails = new Set(
      (c.env.ALLOWED_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!email || !profile.email_verified || !allowedEmails.has(email)) {
      return c.text("This account is not on the invite list", 403);
    }

    const timestamp = now();
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`,
    )
      .bind(newId(), email, profile.name ?? email, timestamp, timestamp)
      .run();
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    if (!user) return c.text("Unable to create user session", 500);

    const sessionId = createSessionId();
    await c.env.DB.prepare(
      "INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
      .bind(
        sessionId,
        user.id,
        timestamp,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .run();
    c.header("Set-Cookie", sessionCookie(sessionId, true));
    return c.redirect("/");
  });

  app.post("/auth/logout", async (c) => {
    const sessionId = c.req.raw.headers
      .get("Cookie")
      ?.split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith("movie_list_session="))
      ?.split("=")[1];
    if (sessionId) {
      await c.env.DB.prepare("DELETE FROM auth_sessions WHERE id = ?")
        .bind(sessionId)
        .run();
    }
    c.header("Set-Cookie", sessionCookie("", !isLocal(c.env), 0));
    return c.json({ ok: true });
  });
};
