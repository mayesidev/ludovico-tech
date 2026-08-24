import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Base64Url, type AppEnv } from "./env";
import { createApp } from "./index";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";

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
  returnTo = "/",
) => {
  await env.DB.prepare(
    "INSERT INTO oauth_states (state, code_verifier, created_at, expires_at, return_to) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(state, "test-code-verifier", past, expiresAt, returnTo)
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

describe("production runtime configuration", () => {
  it("fails health closed for invalid or incomplete production bindings", async () => {
    const invalid = await request(
      "/api/health",
      productionEnv({ AUTH_MODE: "development" }),
    );
    expect(invalid.status).toBe(503);
    expect(await invalid.json()).toEqual({
      error: "Application is not configured",
    });

    const incomplete = await request("/api/health", productionEnv());
    expect(incomplete.status).toBe(503);
    expect(await incomplete.json()).toMatchObject({
      environment: "production",
      ok: false,
    });

    const ready = await request(
      "/api/health",
      productionEnv({
        ...googleConfiguration,
        TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
      }),
    );
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      environment: "production",
      ok: true,
    });
  });
});

describe("Google authentication", () => {
  it("creates a short-lived state with an S256 PKCE challenge", async () => {
    const response = await request(
      "/api/auth/google?returnTo=%2Fmovies%2Fmovie-1%3Ffrom%3Dnow-showing",
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
      "SELECT code_verifier, expires_at, return_to FROM oauth_states WHERE state = ?",
    )
      .bind(state)
      .first<{
        code_verifier: string;
        expires_at: string;
        return_to: string;
      }>();
    expect(stored).toBeTruthy();
    expect(await sha256Base64Url(stored!.code_verifier)).toBe(
      location.searchParams.get("code_challenge"),
    );
    expect(stored!.expires_at > new Date().toISOString()).toBe(true);
    expect(stored!.return_to).toBe("/movies/movie-1?from=now-showing");
  });

  it.each([
    "https://example.test/movies/movie-1",
    "//example.test/movies/movie-1",
    "/\\\\example.test/movies/movie-1",
  ])(
    "falls back to Now Showing for an unsafe return path: %s",
    async (returnTo) => {
      const response = await request(
        `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`,
        productionEnv(googleConfiguration),
      );
      const state = new URL(
        response.headers.get("Location") ?? "",
      ).searchParams.get("state");
      const stored = await env.DB.prepare(
        "SELECT return_to FROM oauth_states WHERE state = ?",
      )
        .bind(state)
        .first<{ return_to: string }>();

      expect(stored?.return_to).toBe("/");
    },
  );

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
    const state = await insertOauthState(
      "successful-state",
      future,
      "/movies/movie-1?from=now-showing",
    );
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
    expect(callback.headers.get("Location")).toBe(
      "/movies/movie-1?from=now-showing",
    );
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

describe("IMDb references", () => {
  it("normalizes a mobile title URL without requesting provider data", async () => {
    const session = await authenticated();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await request("/api/movies", session.bindings, {
      method: "POST",
      headers: { Cookie: session.cookie },
      body: JSON.stringify({
        imdbId: "https://m.imdb.com/title/TT0117509/?ref_=fn_all_ttl_1#reviews",
        title: "IMDb-linked Movie",
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      movie: {
        imdb_id: "tt0117509",
        poster_path: null,
        release_date: null,
        runtime_minutes: null,
        title: "IMDb-linked Movie",
        tmdb_id: null,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows clearing an IMDb ID and rejects duplicates", async () => {
    const session = await authenticated();
    const create = (title: string, imdbId: string) =>
      request("/api/movies", session.bindings, {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: JSON.stringify({ imdbId, title }),
      });
    const first = await create("First IMDb Movie", "tt0117509");
    const firstMovie = (await first.json()) as {
      movie: { id: string; imdb_id: string | null };
    };
    const duplicate = await create(
      "Duplicate IMDb Movie",
      "https://www.imdb.com/title/tt0117509/",
    );

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: "That IMDb movie is already in the catalog",
    });

    const cleared = await request(
      `/api/movies/${firstMovie.movie.id}`,
      session.bindings,
      {
        method: "PATCH",
        headers: { Cookie: session.cookie },
        body: JSON.stringify({ imdbId: null }),
      },
    );
    expect(await cleared.json()).toMatchObject({ movie: { imdb_id: null } });
    expect((await create("Reused IMDb Movie", "TT0117509")).status).toBe(201);
  });

  it("rejects non-IMDb hosts and non-title paths", async () => {
    const session = await authenticated();
    for (const imdbId of [
      "https://example.com/title/tt0117509/",
      "https://www.imdb.com/name/tt0117509/",
    ]) {
      const response = await request("/api/movies", session.bindings, {
        method: "POST",
        headers: { Cookie: session.cookie },
        body: JSON.stringify({ imdbId, title: "Invalid IMDb Movie" }),
      });
      expect(response.status).toBe(400);
    }
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            belongs_to_collection: {
              id: 901,
              name: "Authoritative Collection",
            },
            credits: {
              cast: [
                { id: 4, name: "Fourth Actor", order: 3 },
                { id: 1, name: "First Actor", order: 0 },
                { id: 2, name: "Second Actor", order: 1 },
                { id: 2, name: "Duplicate Actor", order: 2 },
                { id: 3, name: "Third Actor", order: 2 },
                { id: 5, name: "Fifth Actor", order: 4 },
                { id: 6, name: "Sixth Actor", order: 5 },
              ],
              crew: [
                { id: 21, job: "Director", name: "First Director" },
                { id: 22, job: "Director", name: "Second Director" },
                { id: 21, job: "Director", name: "Duplicate Director" },
                { id: 23, job: "Director", name: "Third Director" },
                { id: 24, job: "Director", name: "Fourth Director" },
                { id: 25, job: "Producer", name: "Not a Director" },
              ],
            },
            id: 201,
            poster_path: "/authoritative.jpg",
            release_date: "2026-08-05",
            runtime: 126,
            title: "Authoritative Movie",
          }),
          { status: 200 },
        ),
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
        cast: [
          { id: 1, name: "First Actor" },
          { id: 2, name: "Second Actor" },
          { id: 3, name: "Third Actor" },
          { id: 4, name: "Fourth Actor" },
          { id: 5, name: "Fifth Actor" },
        ],
        collection: { id: 901, name: "Authoritative Collection" },
        directors: [
          { id: 21, name: "First Director" },
          { id: 22, name: "Second Director" },
          { id: 23, name: "Third Director" },
        ],
        id: 201,
        posterPath: "/authoritative.jpg",
        releaseDate: "2026-08-05",
        runtimeMinutes: 126,
        title: "Authoritative Movie",
      },
    });
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstream = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(upstream.searchParams.get("append_to_response")).toBe("credits");

    const detailCache = await env.DB.prepare(
      "SELECT cache_key FROM tmdb_cache WHERE payload_json LIKE ?",
    )
      .bind('%"id":201%')
      .first<{ cache_key: string }>();
    await env.DB.prepare(
      "UPDATE tmdb_cache SET payload_json = ? WHERE cache_key = ?",
    )
      .bind(
        JSON.stringify({
          collection: null,
          id: 201,
          posterPath: "/authoritative.jpg",
          releaseDate: "2026-08-05",
          title: "Authoritative Movie",
        }),
        detailCache!.cache_key,
      )
      .run();
    const refreshed = await request("/api/tmdb/movies/201", session.bindings, {
      headers: { Cookie: session.cookie },
    });
    expect(await refreshed.json()).toMatchObject({
      movie: { runtimeMinutes: 126 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          belongs_to_collection: null,
          id: 401,
          poster_path: null,
          release_date: "2026-08-06",
          runtime: 100,
          title: "Missing Credits",
        }),
        { status: 200 },
      ),
    );
    const malformed = await request("/api/tmdb/movies/401", session.bindings, {
      headers: { Cookie: session.cookie },
    });
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({ error: "TMDB lookup failed" });
  });

  it("uses authoritative details for attachment and rejects duplicates", async () => {
    const session = await authenticated({
      TMDB_READ_ACCESS_TOKEN: "test-tmdb-token",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            belongs_to_collection: {
              id: 902,
              name: "Attached Collection",
            },
            credits: {
              cast: [
                { id: 31, name: "Lead Actor", order: 0 },
                { id: 32, name: "Second Actor", order: 1 },
              ],
              crew: [{ id: 41, job: "Director", name: "Attached Director" }],
            },
            id: 301,
            poster_path: "/authoritative.jpg",
            release_date: "2026-08-05",
            runtime: 126,
            title: "Authoritative Movie",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            belongs_to_collection: null,
            credits: { cast: [], crew: [] },
            id: 302,
            poster_path: "/refreshed.jpg",
            release_date: "2026-08-06",
            runtime: 144,
            title: "Refreshed Authoritative Movie",
          }),
          { status: 200 },
        ),
      );
    const versionWithoutTmdb = await request("/api/movies", session.bindings, {
      method: "POST",
      headers: { Cookie: session.cookie },
      body: JSON.stringify({
        title: "Unlinked Version",
        version: "Director's Cut",
      }),
    });
    expect(versionWithoutTmdb.status).toBe(400);
    expect(await versionWithoutTmdb.json()).toEqual({
      error: "Select a TMDB movie before specifying a version",
    });
    const init = {
      method: "POST",
      headers: { Cookie: session.cookie },
      body: JSON.stringify({
        collectionName: "Broad Local Collection",
        posterPath: "/spoofed.jpg",
        releaseDate: "1900-01-01",
        title: "Spoofed title",
        tmdbId: 301,
        version: "Director's Cut",
        versionReferenceUrl: "https://example.com/cuts/301",
        versionRuntime: 139,
      }),
    };

    const created = await request("/api/movies", session.bindings, init);
    const duplicate = await request("/api/movies", session.bindings, init);
    const movie = ((await created.json()) as { movie: Record<string, unknown> })
      .movie;

    expect(created.status).toBe(201);
    expect(movie).toMatchObject({
      cast: [
        { name: "Lead Actor", tmdbId: 31 },
        { name: "Second Actor", tmdbId: 32 },
      ],
      directors: [{ name: "Attached Director", tmdbId: 41 }],
      poster_path: "/authoritative.jpg",
      release_date: "2026-08-05",
      runtime_minutes: 126,
      title: "Authoritative Movie",
      tmdb_collection_id: 902,
      tmdb_collection_name: "Attached Collection",
      tmdb_id: 301,
      version: "Director's Cut",
      version_reference_url: "https://example.com/cuts/301",
      version_runtime: 139,
    });
    expect(movie).not.toHaveProperty("tmdb_fetched_at");
    expect(movie).not.toHaveProperty("added_by");
    expect(movie).not.toHaveProperty("updated_by");
    expect(
      await env.DB.prepare(
        `SELECT movie_tmdb_data.contract_id, tmdb_collections.name AS collection_name
         FROM movie_tmdb_data
         LEFT JOIN tmdb_collections
           ON tmdb_collections.tmdb_id = movie_tmdb_data.tmdb_collection_id
         WHERE movie_tmdb_data.movie_id = ?`,
      )
        .bind(String(movie.id))
        .first(),
    ).toEqual({
      collection_name: "Attached Collection",
      contract_id: await getTmdbMetadataContractId(),
    });

    const publicDetail = await request(
      `/api/movies/${String(movie.id)}`,
      session.bindings,
    );
    expect(publicDetail.status).toBe(200);
    expect(await publicDetail.json()).toMatchObject({
      movie: {
        cast: [
          { name: "Lead Actor", tmdbId: 31 },
          { name: "Second Actor", tmdbId: 32 },
        ],
        directors: [{ name: "Attached Director", tmdbId: 41 }],
      },
    });

    const compactList = (await (
      await request("/api/movies", session.bindings)
    ).json()) as { movies: Array<Record<string, unknown>> };
    const compactMovie = compactList.movies.find(
      (candidate) => candidate.id === movie.id,
    );
    expect(compactMovie).not.toHaveProperty("cast");
    expect(compactMovie).not.toHaveProperty("directors");

    await env.DB.prepare(
      `UPDATE now_showing
       SET movie_id = ?, rolled_movie_id = ?, status = 'ready'
       WHERE id = 1`,
    )
      .bind(String(movie.id), String(movie.id))
      .run();
    const current = await request("/api/now-showing", session.bindings);
    expect(await current.json()).toMatchObject({
      nowShowing: {
        cast: [
          { name: "Lead Actor", tmdbId: 31 },
          { name: "Second Actor", tmdbId: 32 },
        ],
        directors: [{ name: "Attached Director", tmdbId: 41 }],
      },
    });

    const ordinaryEdit = await request(
      `/api/movies/${String(movie.id)}`,
      session.bindings,
      {
        method: "PATCH",
        headers: { Cookie: session.cookie },
        body: JSON.stringify({ versionRuntime: 140 }),
      },
    );
    expect(await ordinaryEdit.json()).toMatchObject({
      movie: {
        cast: [
          { name: "Lead Actor", tmdbId: 31 },
          { name: "Second Actor", tmdbId: 32 },
        ],
        directors: [{ name: "Attached Director", tmdbId: 41 }],
      },
    });

    const collectionDetail = await request(
      `/api/collections/${String(movie.collection_id)}`,
      session.bindings,
    );
    expect(await collectionDetail.json()).toMatchObject({
      collection: { name: "Broad Local Collection" },
      tmdbCollections: [{ id: 902, name: "Attached Collection" }],
    });

    const staleEdit = await request(
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
    expect(staleEdit.status).toBe(400);
    expect(await staleEdit.json()).toEqual({
      error: "Confirm or remove the TMDB match after changing the title",
    });

    const unlinked = await request(
      `/api/movies/${String(movie.id)}`,
      session.bindings,
      {
        method: "PATCH",
        headers: { Cookie: session.cookie },
        body: JSON.stringify({
          title: "Allowed manual title",
          tmdbId: null,
        }),
      },
    );
    expect(await unlinked.json()).toMatchObject({
      movie: {
        cast: [],
        directors: [],
        poster_path: null,
        release_date: null,
        runtime_minutes: null,
        title: "Allowed manual title",
        tmdb_collection_id: null,
        tmdb_collection_name: null,
        tmdb_id: null,
        version: null,
        version_reference_url: null,
        version_runtime: null,
      },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM movie_credits WHERE movie_id = ?",
      )
        .bind(String(movie.id))
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM tmdb_people").first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM tmdb_collections",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM movie_tmdb_data WHERE movie_id = ?",
      )
        .bind(String(movie.id))
        .first(),
    ).toEqual({ count: 0 });
    expect(duplicate.status).toBe(409);

    const refreshed = await request(
      `/api/movies/${String(movie.id)}`,
      session.bindings,
      {
        method: "PATCH",
        headers: { Cookie: session.cookie },
        body: JSON.stringify({ tmdbId: 302 }),
      },
    );
    expect(await refreshed.json()).toMatchObject({
      movie: {
        cast: [],
        directors: [],
        poster_path: "/refreshed.jpg",
        release_date: "2026-08-06",
        runtime_minutes: 144,
        title: "Refreshed Authoritative Movie",
        tmdb_collection_id: null,
        tmdb_collection_name: null,
        tmdb_id: 302,
      },
    });
    const storedMetadata = await env.DB.prepare(
      `SELECT movie_tmdb_data.runtime_minutes,
              movie_tmdb_data.tmdb_collection_id,
              tmdb_collections.name AS tmdb_collection_name,
              movie_tmdb_data.tmdb_id,
              movie_tmdb_data.fetched_at
       FROM movie_tmdb_data
       LEFT JOIN tmdb_collections
         ON tmdb_collections.tmdb_id = movie_tmdb_data.tmdb_collection_id
       WHERE movie_tmdb_data.movie_id = ?`,
    )
      .bind(String(movie.id))
      .first<{
        runtime_minutes: number | null;
        tmdb_collection_id: number | null;
        tmdb_collection_name: string | null;
        fetched_at: string | null;
        tmdb_id: number | null;
      }>();
    expect(storedMetadata).toEqual({
      runtime_minutes: 144,
      tmdb_collection_id: null,
      tmdb_collection_name: null,
      fetched_at: expect.any(String),
      tmdb_id: 302,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("production authorization boundary", () => {
  it("keeps public reads open and rejects every anonymous domain mutation", async () => {
    const bindings = productionEnv({ ALLOWED_EMAILS: invitedEmail });
    const publicReads = [
      "/api/movies",
      "/api/library",
      "/api/collections",
      "/api/now-showing",
      "/api/home",
      "/api/auth/me",
    ];
    for (const path of publicReads) {
      expect((await request(path, bindings)).status).toBe(200);
    }
    expect((await request("/api/tmdb-refresh", bindings)).status).toBe(401);
    expect((await request("/api/tmdb-refresh/summary", bindings)).status).toBe(
      401,
    );
    expect((await request("/api/tmdb-refresh/items", bindings)).status).toBe(
      401,
    );

    const mutations: Array<[string, string, unknown?]> = [
      ["/api/movies", "POST", { title: "Unauthorized Movie" }],
      [
        "/api/movies/00000000-0000-4000-8000-000000000001",
        "PATCH",
        { title: "Unauthorized Edit" },
      ],
      ["/api/movies/00000000-0000-4000-8000-000000000001", "DELETE"],
      [
        "/api/movies/00000000-0000-4000-8000-000000000001/rate",
        "POST",
        { phrase: "Unauthorized Rating", score: 4 },
      ],
      ["/api/roll", "POST"],
      [
        "/api/collections/00000000-0000-4000-8000-000000000001/order",
        "POST",
        { movieIds: ["00000000-0000-4000-8000-000000000001"] },
      ],
      ["/api/next", "POST"],
      ["/api/tmdb-refresh/run", "POST"],
      ["/api/tmdb-refresh/schedule", "PATCH", { enabled: false }],
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
