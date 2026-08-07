import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "./env";
import { createApp } from "./index";

const app = createApp();
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
      headers: { "Content-Type": "application/json", ...init?.headers },
      ...init,
    }),
    bindings,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TMDB routes", () => {
  it("maps successful search results without calling the real API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 123,
              title: "Mock Movie",
              release_date: "2026-08-04",
              poster_path: "/mock-poster.jpg",
              imdb_id: "tt1234567",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await request(
      "/api/tmdb/search?query=Mock%20Movie",
      productionEnv({ TMDB_READ_ACCESS_TOKEN: "test-tmdb-token" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          id: 123,
          title: "Mock Movie",
          releaseDate: "2026-08-04",
          posterPath: "/mock-poster.jpg",
          imdbId: "tt1234567",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.themoviedb.org/3/search/movie?query=Mock%20Movie&include_adult=false&language=en-US",
      {
        headers: {
          Authorization: "Bearer test-tmdb-token",
          accept: "application/json",
        },
      },
    );
  });

  it("reports missing TMDB configuration without making a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await request(
      "/api/tmdb/search?query=Unconfigured",
      productionEnv(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "TMDB is not configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through an upstream TMDB error without leaking its response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream details", { status: 429 }),
    );

    const response = await request(
      "/api/tmdb/search?query=Rate%20Limited",
      productionEnv({ TMDB_READ_ACCESS_TOKEN: "test-tmdb-token" }),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "TMDB lookup failed" });
  });
});

describe("Google OAuth callback", () => {
  it("rejects callbacks that do not include the required parameters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await request(
      "/api/auth/google/callback?code=test-code",
      productionEnv({
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
        GOOGLE_REDIRECT_URI:
          "https://ludovico-tech.test/api/auth/google/callback",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid OAuth callback");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a valid Google profile that is not on the invite list", async () => {
    const state = "test-oauth-state";
    await env.DB.prepare(
      "INSERT INTO oauth_states (state, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
      .bind(
        state,
        "test-code-verifier",
        "2026-08-04T00:00:00.000Z",
        "2099-08-04T00:00:00.000Z",
      )
      .run();

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "test-access-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "not-invited@example.test",
            email_verified: true,
            name: "Uninvited User",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const response = await request(
      `/api/auth/google/callback?code=test-code&state=${state}`,
      productionEnv({
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
        GOOGLE_REDIRECT_URI:
          "https://ludovico-tech.test/api/auth/google/callback",
        ALLOWED_EMAILS: "invited@example.test",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "This account is not on the invite list",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://oauth2.googleapis.com/token",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://openidconnect.googleapis.com/v1/userinfo",
    );
  });
});
