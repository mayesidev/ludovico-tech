import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const worker = exports.default;

const request = async <T>(path: string, init?: RequestInit) => {
  const response = await worker.fetch(new Request(`https://ludovico-tech.test${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  }));
  const body = await response.json() as T;
  return { response, body };
};

describe("movie list Worker routes", () => {
  it("serves health and an empty public catalog", async () => {
    const health = await request<{ ok: boolean; environment: string }>("/api/health");
    expect(health.response.status).toBe(200);
    expect(health.body).toEqual({ ok: true, environment: "development" });

    const catalog = await request<{ movies: unknown[] }>("/api/movies");
    expect(catalog.response.status).toBe(200);
    expect(catalog.body.movies).toEqual([]);
  });

  it("supports adding, rolling, rating, and watched-state filtering", async () => {
    const added = await request<{ movie: { id: string; title: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Integration Movie" }),
    });
    expect(added.response.status).toBe(201);
    expect(added.body.movie.title).toBe("Integration Movie");

    const rolled = await request<{ rolledMovie: { id: string }; nowShowing: { movie_id: string; status: string } }>("/api/roll", { method: "POST" });
    expect(rolled.response.status).toBe(200);
    expect(rolled.body.rolledMovie.id).toBe(added.body.movie.id);
    expect(rolled.body.nowShowing).toMatchObject({ movie_id: added.body.movie.id, status: "ready" });

    const rated = await request<{ movie: { rating_score: number; rating_phrase: string; watched_at: string | null } }>(`/api/movies/${added.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 4.5, phrase: "A thoroughly testable delight" }),
    });
    expect(rated.response.status).toBe(200);
    expect(rated.body.movie).toMatchObject({ rating_score: 4.5, rating_phrase: "A thoroughly testable delight" });
    expect(rated.body.movie.watched_at).toEqual(expect.any(String));

    const watched = await request<{ movies: Array<{ id: string }> }>("/api/movies?status=watched");
    const unwatched = await request<{ movies: Array<{ id: string }> }>("/api/movies?status=unwatched");
    expect(watched.body.movies.map((movie) => movie.id)).toEqual([added.body.movie.id]);
    expect(unwatched.body.movies).toEqual([]);
  });

  it("persists a franchise order and advances to the next movie", async () => {
    const first = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Integration Chapter One", franchiseName: "Integration Saga" }),
    });
    const second = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Integration Chapter Two", franchiseName: "Integration Saga" }),
    });

    const rolled = await request<{ needsOrder: boolean; franchiseMovies: Array<{ id: string }> }>("/api/roll", { method: "POST" });
    expect(rolled.response.status).toBe(200);
    expect(rolled.body.needsOrder).toBe(true);
    expect(rolled.body.franchiseMovies.map((movie) => movie.id).sort()).toEqual([first.body.movie.id, second.body.movie.id].sort());

    const franchiseId = (await request<{ movies: Array<{ id: string; franchise_id: string }> }>("/api/movies")).body.movies[0].franchise_id;
    const ordered = await request<{ nowShowing: { movie_id: string; status: string } }>(`/api/franchises/${franchiseId}/order`, {
      method: "POST",
      body: JSON.stringify({ movieIds: [second.body.movie.id, first.body.movie.id] }),
    });
    expect(ordered.response.status).toBe(200);
    expect(ordered.body.nowShowing).toMatchObject({ movie_id: second.body.movie.id, status: "ready" });

    await request(`/api/movies/${second.body.movie.id}/rate`, { method: "POST", body: JSON.stringify({ score: 3, phrase: "Sequels can work" }) });
    const next = await request<{ nowShowing: { movie_id: string } }>("/api/next", { method: "POST" });
    expect(next.response.status).toBe(200);
    expect(next.body.nowShowing.movie_id).toBe(first.body.movie.id);
  });

  it("rejects ratings that use quarter points", async () => {
    const added = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Invalid Rating Movie" }),
    });
    const result = await request<{ error: string }>(`/api/movies/${added.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 4.25, phrase: "Not allowed" }),
    });
    expect(result.response.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain("whole or half points");
  });
});
