import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

const jsonResponse = (body: unknown = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

describe("client API", () => {
  it("uses the stable routes and request bodies", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(jsonResponse());

    await api.authMe();
    await api.logout();
    await api.nowShowing();
    await api.movies("watched");
    await api.franchise("franchise-id");
    await api.roll();
    await api.next();
    await api.rate("movie-id", 4.5, "Custom phrase");
    await api.order("franchise-id", ["first", "second"]);
    await api.addMovie({
      franchiseName: "Saga",
      title: "Movie",
      tmdbId: 42,
    });
    await api.updateMovie("movie-id", { title: "New title" });
    await api.tmdbSearch("A movie & sequel");
    await api.tmdbMovie(42);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/auth/me",
      "/api/auth/logout",
      "/api/now-showing",
      "/api/movies?status=watched",
      "/api/franchises/franchise-id",
      "/api/roll",
      "/api/next",
      "/api/movies/movie-id/rate",
      "/api/franchises/franchise-id/order",
      "/api/movies",
      "/api/movies/movie-id",
      "/api/tmdb/search?query=A%20movie%20%26%20sequel",
      "/api/tmdb/movies/42",
    ]);
    expect(fetchMock.mock.calls[7]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[7]?.[1]?.body))).toEqual({
      phrase: "Custom phrase",
      score: 4.5,
    });
    expect(fetchMock.mock.calls[8]?.[1]).toMatchObject({
      body: JSON.stringify({ movieIds: ["first", "second"] }),
      method: "POST",
    });
    expect(fetchMock.mock.calls[9]?.[1]).toMatchObject({
      body: JSON.stringify({
        franchiseName: "Saga",
        title: "Movie",
        tmdbId: 42,
      }),
      method: "POST",
    });
    expect(fetchMock.mock.calls[10]?.[1]).toMatchObject({
      body: JSON.stringify({ title: "New title" }),
      method: "PATCH",
    });
  });

  it("returns parsed JSON and preserves a safe HTTP error status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authenticated: false, actor: null, local: false }),
    );
    await expect(api.authMe()).resolves.toEqual({
      actor: null,
      authenticated: false,
      local: false,
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "Authentication required" }, 401),
    );
    await expect(api.roll()).rejects.toEqual(
      expect.objectContaining<ApiError>({
        message: "Authentication required",
        name: "ApiError",
        status: 401,
      }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("not json", { status: 502 }),
    );
    await expect(api.nowShowing()).rejects.toMatchObject({
      message: "Something went wrong",
      status: 502,
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: { issues: [{ message: "Invalid UUID" }] } }, 400),
    );
    await expect(
      api.order("franchise-id", ["movie-imported"]),
    ).rejects.toMatchObject({
      message: "Request validation failed",
      status: 400,
    });
  });
});
