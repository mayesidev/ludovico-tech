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

    await api.health();
    await api.authMe();
    await api.logout();
    await api.home();
    await api.library({
      direction: "desc",
      page: 2,
      pageSize: 25,
      search: "Movie & sequel",
      sort: "rating",
      status: "watched",
    });
    await api.collection("collection-id");
    await api.collectionSuggestions("Saga & sequels");
    await api.roll();
    await api.next();
    await api.rate("movie-id", 4.5, "Custom phrase");
    await api.order("collection-id", ["first", "second"]);
    await api.addMovie({
      collectionName: "Saga",
      imdbId: "tt0117509",
      title: "Movie",
      tmdbId: 42,
    });
    await api.updateMovie("movie-id", { imdbId: null, title: "New title" });
    await api.deleteMovie("movie-id");
    await api.tmdbSearch("A movie & sequel");
    await api.tmdbMovie(42);
    await api.tmdbRefreshRunStatus();
    await api.tmdbRefreshOverview({
      dateSearch: "",
      direction: "asc",
      page: 1,
      pageSize: 50,
      search: "",
      sort: "state",
      state: "all",
    });
    await api.tmdbRefreshQueue({
      dateSearch: "2026-08-23T18:45:00.000Z",
      direction: "desc",
      page: 2,
      pageSize: 25,
      search: "Current",
      sort: "fetchedAt",
      state: "current",
    });
    await api.queueTmdbRefetch("movie/id");
    await api.updateTmdbRefreshSchedule({
      batchSize: 50,
      intervalMinutes: 360,
    });
    await api.runTmdbRefresh();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/health",
      "/api/auth/me",
      "/api/auth/logout",
      "/api/home",
      "/api/library?direction=desc&page=2&pageSize=25&search=Movie+%26+sequel&sort=rating&status=watched",
      "/api/collections/collection-id",
      "/api/collections/suggestions?search=Saga%20%26%20sequels",
      "/api/roll",
      "/api/next",
      "/api/movies/movie-id/rate",
      "/api/collections/collection-id/order",
      "/api/movies",
      "/api/movies/movie-id",
      "/api/movies/movie-id",
      "/api/tmdb/search?query=A%20movie%20%26%20sequel",
      "/api/tmdb/movies/42",
      "/api/tmdb-refresh/run-status",
      "/api/tmdb-refresh/overview?dateSearch=&direction=asc&page=1&pageSize=50&search=&sort=state&state=all",
      "/api/tmdb-refresh/items?dateSearch=2026-08-23T18%3A45%3A00.000Z&direction=desc&page=2&pageSize=25&search=Current&sort=fetchedAt&state=current",
      "/api/tmdb-refresh/items/movie%2Fid/refetch",
      "/api/tmdb-refresh/schedule",
      "/api/tmdb-refresh/run",
    ]);
    expect(fetchMock.mock.calls[9]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[9]?.[1]?.body))).toEqual({
      phrase: "Custom phrase",
      score: 4.5,
    });
    expect(fetchMock.mock.calls[10]?.[1]).toMatchObject({
      body: JSON.stringify({ movieIds: ["first", "second"] }),
      method: "POST",
    });
    expect(fetchMock.mock.calls[11]?.[1]).toMatchObject({
      body: JSON.stringify({
        collectionName: "Saga",
        imdbId: "tt0117509",
        title: "Movie",
        tmdbId: 42,
      }),
      method: "POST",
    });
    expect(fetchMock.mock.calls[12]?.[1]).toMatchObject({
      body: JSON.stringify({ imdbId: null, title: "New title" }),
      method: "PATCH",
    });
    expect(fetchMock.mock.calls[13]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[19]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[20]?.[1]).toMatchObject({
      body: JSON.stringify({ batchSize: 50, intervalMinutes: 360 }),
      method: "PATCH",
    });
    expect(fetchMock.mock.calls[21]?.[1]).toMatchObject({ method: "POST" });
  });

  it("returns parsed JSON and preserves a safe HTTP error status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authenticated: false, user: null, local: false }),
    );
    await expect(api.authMe()).resolves.toEqual({
      user: null,
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
    await expect(api.home()).rejects.toMatchObject({
      message: "Something went wrong",
      status: 502,
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: { issues: [{ message: "Invalid UUID" }] } }, 400),
    );
    await expect(
      api.order("collection-id", ["movie-imported"]),
    ).rejects.toMatchObject({
      message: "Request validation failed",
      status: 400,
    });
  });
});
