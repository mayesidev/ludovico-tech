import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Base64Url, type AppEnv } from "./env";
import { createApp } from "./index";

const app = createApp();
const future = "2099-08-04T00:00:00.000Z";
const past = "2000-08-04T00:00:00.000Z";
const invitedEmail = "invited@example.test";

const googleConfiguration = {
  ALLOWED_EMAILS: invitedEmail,
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_REDIRECT_URI: "https://ludovico-tech.test/api/auth/google/callback",
};

const productionEnv = (overrides: Partial<AppEnv["Bindings"]> = {}) =>
  ({
    ...env,
    APP_ENV: "production",
    AUTH_MODE: "google",
    TMDB_READ_ACCESS_TOKEN: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    GOOGLE_REDIRECT_URI: undefined,
    ALLOWED_EMAILS: undefined,
    ...overrides,
  }) as AppEnv["Bindings"];

const request = async (
  path: string,
  bindings: AppEnv["Bindings"],
  init?: RequestInit,
) =>
  app.fetch(
    new Request(`https://ludovico-tech.test${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    }),
    bindings,
  );

const insertOauthState = async (
  state = "test-oauth-state",
  expiresAt = future,
) => {
  await env.DB.prepare(
    "INSERT INTO oauth_states (state, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(state, "test-code-verifier", past, expiresAt)
    .run();
  return state;
};

const authenticated = async (
  overrides: Partial<AppEnv["Bindings"]> = {},
  expiresAt = future,
) => {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(invitedEmail)
    .first<{ id: string }>();
  const userId = existing?.id ?? crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(userId, invitedEmail, "Invited User", past)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(sessionId, userId, past, expiresAt)
    .run();
  return {
    bindings: productionEnv({
      ALLOWED_EMAILS: invitedEmail,
      ...overrides,
    }),
    cookie: `ludovico_tech_session=${sessionId}`,
    sessionId,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google authentication", () => {
  it("creates a short-lived state with an S256 PKCE challenge", async () => {
    const response = await request(
      "/api/auth/google",
      productionEnv(googleConfiguration),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "");
    const state = location.searchParams.get("state");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state).toBeTruthy();

    const stored = await env.DB.prepare(
      "SELECT code_verifier, expires_at FROM oauth_states WHERE state = ?",
    )
      .bind(state)
      .first<{ code_verifier: string; expires_at: string }>();
    expect(stored).toBeTruthy();
    expect(await sha256Base64Url(stored!.code_verifier)).toBe(
      location.searchParams.get("code_challenge"),
    );
    expect(stored!.expires_at > new Date().toISOString()).toBe(true);
  });

  it("rejects callbacks without a valid unexpired state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const missing = await request(
      "/api/auth/google/callback?code=test-code",
      productionEnv(googleConfiguration),
    );
    const expiredState = await insertOauthState("expired-state", past);
    const expired = await request(
      `/api/auth/google/callback?code=test-code&state=${expiredState}`,
      productionEnv(googleConfiguration),
    );

    expect(missing.status).toBe(400);
    expect(expired.status).toBe(400);
    expect(await expired.text()).toBe("OAuth state expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consumes OAuth state once even when token exchange fails", async () => {
    const state = await insertOauthState();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("private upstream body", { status: 500 }),
      );

    const first = await request(
      `/api/auth/google/callback?code=test-code&state=${state}`,
      productionEnv(googleConfiguration),
    );
    const replay = await request(
      `/api/auth/google/callback?code=test-code&state=${state}`,
      productionEnv(googleConfiguration),
    );

    expect(first.status).toBe(502);
    expect(await first.text()).toBe("Authentication provider unavailable");
    expect(replay.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps malformed token and profile responses to a generic failure", async () => {
    const tokenState = await insertOauthState("token-state");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: "private" }), { status: 200 }),
    );
    const tokenFailure = await request(
      `/api/auth/google/callback?code=test-code&state=${tokenState}`,
      productionEnv(googleConfiguration),
    );

    const profileState = await insertOauthState("profile-state");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "test-access-token" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response("private profile body", { status: 503 }),
      );
    const profileFailure = await request(
      `/api/auth/google/callback?code=test-code&state=${profileState}`,
      productionEnv(googleConfiguration),
    );

    expect(tokenFailure.status).toBe(502);
    expect(profileFailure.status).toBe(502);
    expect(await profileFailure.text()).toBe(
      "Authentication provider unavailable",
    );
  });

  it("rejects unverified, unidentified, and uninvited profiles", async () => {
    const profiles = [
      { email: invitedEmail, email_verified: false, sub: "google-subject" },
      { email: invitedEmail, email_verified: true },
      {
        email: "not-invited@example.test",
        email_verified: true,
        sub: "google-subject",
      },
    ];

    for (const [index, profile] of profiles.entries()) {
      const state = await insertOauthState(`rejected-state-${index}`);
      const fetchMock = vi.spyOn(globalThis, "fetch");
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "test-access-token" }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(profile), { status: 200 }),
        );
      const response = await request(
        `/api/auth/google/callback?code=test-code&state=${state}`,
        productionEnv(googleConfiguration),
      );
      expect(response.status).toBe(403);
      vi.restoreAllMocks();
    }
  });

  it("creates an allowlisted session and returns only the public actor", async () => {
    const state = await insertOauthState();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "test-access-token" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: invitedEmail,
            email_verified: true,
            name: "Invited User",
            sub: "google-subject",
          }),
          { status: 200 },
        ),
      );

    const callback = await request(
      `/api/auth/google/callback?code=test-code&state=${state}`,
      productionEnv(googleConfiguration),
    );
    expect(callback.status).toBe(302);
    const cookie = callback.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");

    const me = await request(
      "/api/auth/me",
      productionEnv(googleConfiguration),
      { headers: { Cookie: cookie.split(";")[0] } },
    );
    expect(me.headers.get("Cache-Control")).toBe("no-store");
    expect(await me.json()).toEqual({
      actor: { displayName: "Invited User", email: invitedEmail },
      authenticated: true,
      local: false,
    });
  });

  it("rejects and removes expired sessions", async () => {
    const session = await authenticated({}, past);
    const response = await request("/api/auth/me", session.bindings, {
      headers: { Cookie: session.cookie },
    });

    expect(
      ((await response.json()) as { authenticated: boolean }).authenticated,
    ).toBe(false);
    expect(
      await env.DB.prepare("SELECT id FROM auth_sessions WHERE id = ?")
        .bind(session.sessionId)
        .first(),
    ).toBeNull();
  });

  it("stops authorizing a session after its email leaves the allowlist", async () => {
    const session = await authenticated({
      ALLOWED_EMAILS: "another@example.test",
    });
    const response = await request("/api/auth/me", session.bindings, {
      headers: { Cookie: session.cookie },
    });

    expect(await response.json()).toMatchObject({ authenticated: false });
  });

  it("deletes the current session on logout and clears its cookie", async () => {
    const session = await authenticated();
    const response = await request("/api/auth/logout", session.bindings, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(
      await env.DB.prepare("SELECT id FROM auth_sessions WHERE id = ?")
        .bind(session.sessionId)
        .first(),
    ).toBeNull();
  });
});

describe("TMDB routes and metadata attachment", () => {
  it("rejects anonymous production requests without calling TMDB", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const bindings = productionEnv({
      ALLOWED_EMAILS: invitedEmail,
      TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
    });

    expect(
      (await request("/api/tmdb/search?query=Mock", bindings)).status,
    ).toBe(401);
    expect((await request("/api/tmdb/movies/123", bindings)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches sanitized search results without exposing search-only IMDb data", async () => {
    const session = await authenticated({
      TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 123,
              imdb_id: "tt1234567",
              poster_path: "/mock-poster.jpg",
              release_date: "2026-08-04",
              title: "Mock Movie",
            },
            { id: "invalid", title: "Invalid result" },
          ],
        }),
        { status: 200 },
      ),
    );

    const first = await request(
      "/api/tmdb/search?query=Mock%20Movie",
      session.bindings,
      { headers: { Cookie: session.cookie } },
    );
    const second = await request(
      "/api/tmdb/search?query=Mock%20Movie",
      session.bindings,
      { headers: { Cookie: session.cookie } },
    );

    expect(await first.json()).toEqual({
      results: [
        {
          id: 123,
          posterPath: "/mock-poster.jpg",
          releaseDate: "2026-08-04",
          title: "Mock Movie",
        },
      ],
    });
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstream = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(upstream.origin).toBe("https://api.themoviedb.org");
    expect(upstream.pathname).toBe("/3/search/movie");
    expect(upstream.searchParams.get("query")).toBe("Mock Movie");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-tmdb-token",
      },
    });
  });

  it("caches authoritative movie details", async () => {
    const session = await authenticated({
      TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 201,
          poster_path: "/authoritative.jpg",
          release_date: "2026-08-05",
          title: "Authoritative Movie",
        }),
        { status: 200 },
      ),
    );

    const first = await request("/api/tmdb/movies/201", session.bindings, {
      headers: { Cookie: session.cookie },
    });
    const second = await request("/api/tmdb/movies/201", session.bindings, {
      headers: { Cookie: session.cookie },
    });

    expect(await first.json()).toEqual({
      movie: {
        id: 201,
        posterPath: "/authoritative.jpg",
        releaseDate: "2026-08-05",
        title: "Authoritative Movie",
      },
    });
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps configuration, rate-limit, network, and provider-body failures", async () => {
    const session = await authenticated();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const unconfigured = await request(
      "/api/tmdb/search?query=Unconfigured",
      session.bindings,
      { headers: { Cookie: session.cookie } },
    );
    expect(unconfigured.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();

    session.bindings.TMDB_READ_ACCESS_TOKEN = "test-tmdb-token";
    fetchMock.mockResolvedValueOnce(
      new Response("private provider body", {
        status: 429,
        headers: { "Retry-After": "12" },
      }),
    );
    const limited = await request(
      "/api/tmdb/search?query=Limited",
      session.bindings,
      { headers: { Cookie: session.cookie } },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("12");
    expect(await limited.json()).toEqual({
      error: "TMDB is temporarily rate limited",
    });

    fetchMock.mockRejectedValueOnce(new Error("private network detail"));
    const unavailable = await request(
      "/api/tmdb/search?query=Unavailable",
      session.bindings,
      { headers: { Cookie: session.cookie } },
    );
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ error: "TMDB lookup failed" });
  });

  it("uses authoritative details for attachment and rejects duplicates", async () => {
    const session = await authenticated({
      TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 301,
          poster_path: "/authoritative.jpg",
          release_date: "2026-08-05",
          title: "Authoritative Movie",
        }),
        { status: 200 },
      ),
    );
    const init = {
      method: "POST",
      headers: { Cookie: session.cookie },
      body: JSON.stringify({
        posterPath: "/spoofed.jpg",
        releaseDate: "1900-01-01",
        title: "Spoofed title",
        tmdbId: 301,
      }),
    };

    const created = await request("/api/movies", session.bindings, init);
    const duplicate = await request("/api/movies", session.bindings, init);
    const movie = ((await created.json()) as { movie: Record<string, unknown> })
      .movie;

    expect(created.status).toBe(201);
    expect(movie).toMatchObject({
      poster_path: "/authoritative.jpg",
      release_date: "2026-08-05",
      title: "Authoritative Movie",
      tmdb_id: 301,
    });
    expect(movie).not.toHaveProperty("tmdb_fetched_at");
    expect(movie).not.toHaveProperty("added_by");
    expect(movie).not.toHaveProperty("updated_by");

    const spoofedEdit = await request(
      `/api/movies/${String(movie.id)}`,
      session.bindings,
      {
        method: "PATCH",
        headers: { Cookie: session.cookie },
        body: JSON.stringify({
          title: "Allowed manual title",
          posterPath: "/second-spoof.jpg",
          releaseDate: "1901-01-01",
        }),
      },
    );
    expect(await spoofedEdit.json()).toMatchObject({
      movie: {
        poster_path: "/authoritative.jpg",
        release_date: "2026-08-05",
        title: "Allowed manual title",
      },
    });
    expect(duplicate.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("production authorization boundary", () => {
  it("keeps public reads open and rejects every anonymous domain mutation", async () => {
    const bindings = productionEnv({ ALLOWED_EMAILS: invitedEmail });
    const publicReads = [
      "/api/movies",
      "/api/franchises",
      "/api/now-showing",
      "/api/auth/me",
    ];
    for (const path of publicReads) {
      expect((await request(path, bindings)).status).toBe(200);
    }

    const mutations: Array<[string, string, unknown?]> = [
      ["/api/movies", "POST", { title: "Unauthorized Movie" }],
      [
        "/api/movies/00000000-0000-4000-8000-000000000001",
        "PATCH",
        { title: "Unauthorized Edit" },
      ],
      [
        "/api/movies/00000000-0000-4000-8000-000000000001/rate",
        "POST",
        { phrase: "Unauthorized Rating", score: 4 },
      ],
      ["/api/roll", "POST"],
      [
        "/api/franchises/00000000-0000-4000-8000-000000000001/order",
        "POST",
        { movieIds: ["00000000-0000-4000-8000-000000000001"] },
      ],
      ["/api/next", "POST"],
    ];
    for (const [path, method, body] of mutations) {
      const response = await request(path, bindings, {
        body: body === undefined ? undefined : JSON.stringify(body),
        method,
      });
      expect(response.status).toBe(401);
    }
  });
});
