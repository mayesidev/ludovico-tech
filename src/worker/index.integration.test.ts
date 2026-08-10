import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const worker = exports.default;

const request = async <T>(path: string, init?: RequestInit) => {
  const response = await worker.fetch(
    new Request(`https://ludovico-tech.test${path}`, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      ...init,
    }),
  );
  const body = (await response.json()) as T;
  return { response, body };
};

describe("Ludovico Tech Worker routes", () => {
  it("serves health and an empty public catalog", async () => {
    const health = await request<{
      ok: boolean;
      environment: string;
      version: string;
      commit: string;
    }>("/api/health");
    expect(health.response.status).toBe(200);
    expect(health.body).toEqual({
      ok: true,
      environment: "development",
      version: "unversioned",
      commit: "unknown",
    });

    const catalog = await request<{ movies: unknown[] }>("/api/movies");
    expect(catalog.response.status).toBe(200);
    expect(catalog.body.movies).toEqual([]);
  });

  it("supports adding, rolling, rating, and watched-state filtering", async () => {
    const added = await request<{ movie: { id: string; title: string } }>(
      "/api/movies",
      {
        method: "POST",
        body: JSON.stringify({ title: "Integration Movie" }),
      },
    );
    expect(added.response.status).toBe(201);
    expect(added.body.movie.title).toBe("Integration Movie");

    const rolled = await request<{
      rolledMovie: { id: string };
      nowShowing: { movie_id: string; status: string };
    }>("/api/roll", { method: "POST" });
    expect(rolled.response.status).toBe(200);
    expect(rolled.body.rolledMovie.id).toBe(added.body.movie.id);
    expect(rolled.body.nowShowing).toMatchObject({
      movie_id: added.body.movie.id,
      status: "ready",
    });

    const rated = await request<{
      movie: {
        rating_score: number;
        rating_phrase: string;
        watched_at: string | null;
      };
    }>(`/api/movies/${added.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({
        score: 4.5,
        phrase: "A thoroughly testable delight",
      }),
    });
    expect(rated.response.status).toBe(200);
    expect(rated.body.movie).toMatchObject({
      rating_score: 4.5,
      rating_phrase: "A thoroughly testable delight",
    });
    expect(rated.body.movie.watched_at).toEqual(expect.any(String));

    const watched = await request<{ movies: Array<{ id: string }> }>(
      "/api/movies?status=watched",
    );
    const unwatched = await request<{ movies: Array<{ id: string }> }>(
      "/api/movies?status=unwatched",
    );
    expect(watched.body.movies.map((movie) => movie.id)).toEqual([
      added.body.movie.id,
    ]);
    expect(unwatched.body.movies).toEqual([]);
  });

  it("persists a franchise order and advances to the next movie", async () => {
    const first = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Integration Chapter One",
        franchiseName: "Integration Saga",
      }),
    });
    const second = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Integration Chapter Two",
        franchiseName: "Integration Saga",
      }),
    });

    const rolled = await request<{
      needsOrder: boolean;
      franchiseMovies: Array<{ id: string }>;
    }>("/api/roll", { method: "POST" });
    expect(rolled.response.status).toBe(200);
    expect(rolled.body.needsOrder).toBe(true);
    expect(rolled.body.franchiseMovies.map((movie) => movie.id).sort()).toEqual(
      [first.body.movie.id, second.body.movie.id].sort(),
    );

    const franchiseId = (
      await request<{ movies: Array<{ id: string; franchise_id: string }> }>(
        "/api/movies",
      )
    ).body.movies[0].franchise_id;
    const ordered = await request<{
      nowShowing: { movie_id: string; status: string };
    }>(`/api/franchises/${franchiseId}/order`, {
      method: "POST",
      body: JSON.stringify({
        movieIds: [second.body.movie.id, first.body.movie.id],
      }),
    });
    expect(ordered.response.status).toBe(200);
    expect(ordered.body.nowShowing).toMatchObject({
      movie_id: second.body.movie.id,
      status: "ready",
    });

    await request(`/api/movies/${second.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 3, phrase: "Sequels can work" }),
    });
    const next = await request<{ nowShowing: { movie_id: string } }>(
      "/api/next",
      { method: "POST" },
    );
    expect(next.response.status).toBe(200);
    expect(next.body.nowShowing.movie_id).toBe(first.body.movie.id);
  });

  it("rejects ratings that use quarter points", async () => {
    const added = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Invalid Rating Movie" }),
    });
    const result = await request<{ error: string }>(
      `/api/movies/${added.body.movie.id}/rate`,
      {
        method: "POST",
        body: JSON.stringify({ score: 4.25, phrase: "Not allowed" }),
      },
    );
    expect(result.response.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain("whole or half points");
  });

  it("filters the complete public catalog and returns 404 for missing resources", async () => {
    const watchedMovie = await request<{ movie: { id: string } }>(
      "/api/movies",
      {
        method: "POST",
        body: JSON.stringify({ title: "A Watched Integration Movie" }),
      },
    );
    const unwatchedMovie = await request<{ movie: { id: string } }>(
      "/api/movies",
      {
        method: "POST",
        body: JSON.stringify({ title: "An Unwatched Integration Movie" }),
      },
    );
    await request(`/api/movies/${watchedMovie.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 0, phrase: "A deliberate zero" }),
    });

    const all = await request<{ movies: Array<{ id: string }> }>(
      "/api/movies?status=all",
    );
    const watched = await request<{ movies: Array<{ id: string }> }>(
      "/api/movies?status=watched",
    );
    const unwatched = await request<{ movies: Array<{ id: string }> }>(
      "/api/movies?status=unwatched",
    );

    expect(all.body.movies.map((movie) => movie.id).sort()).toEqual(
      [watchedMovie.body.movie.id, unwatchedMovie.body.movie.id].sort(),
    );
    expect(watched.body.movies.map((movie) => movie.id)).toEqual([
      watchedMovie.body.movie.id,
    ]);
    expect(unwatched.body.movies.map((movie) => movie.id)).toEqual([
      unwatchedMovie.body.movie.id,
    ]);

    const missingFranchise = await request("/api/franchises/missing");
    const missingEdit = await request("/api/movies/missing", {
      method: "PATCH",
      body: JSON.stringify({ title: "Still missing" }),
    });
    const missingRating = await request("/api/movies/missing/rate", {
      method: "POST",
      body: JSON.stringify({ score: 5, phrase: "Still missing" }),
    });
    expect([
      missingFranchise.response.status,
      missingEdit.response.status,
      missingRating.response.status,
    ]).toEqual([404, 404, 404]);
  });

  it("accepts rating boundaries and updates one shared watched rating", async () => {
    const first = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Boundary Zero" }),
    });
    const second = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Boundary Five" }),
    });

    for (const [movieId, score, phrase] of [
      [first.body.movie.id, 0, "Zero but watched"],
      [second.body.movie.id, 5, "Five and watched"],
      [first.body.movie.id, 5, "Updated shared rating"],
    ] as const) {
      const result = await request(`/api/movies/${movieId}/rate`, {
        method: "POST",
        body: JSON.stringify({ phrase, score }),
      });
      expect(result.response.status).toBe(200);
    }

    for (const invalid of [
      { phrase: "Below range", score: -0.5 },
      { phrase: "Above range", score: 5.5 },
      { phrase: "   ", score: 4 },
    ]) {
      const result = await request(`/api/movies/${first.body.movie.id}/rate`, {
        method: "POST",
        body: JSON.stringify(invalid),
      });
      expect(result.response.status).toBe(400);
    }

    const shared = await env.DB.prepare(
      "SELECT COUNT(*) AS count, score, phrase, watched_at FROM ratings WHERE movie_id = ?",
    )
      .bind(first.body.movie.id)
      .first<{
        count: number;
        phrase: string;
        score: number;
        watched_at: string | null;
      }>();
    expect(shared).toMatchObject({
      count: 1,
      phrase: "Updated shared rating",
      score: 5,
      watched_at: expect.any(String),
    });
  });

  it("reports an empty catalog, selects only unwatched movies, and blocks rerolls", async () => {
    const empty = await request<{ error: string }>("/api/roll", {
      method: "POST",
    });
    expect(empty.response.status).toBe(409);
    expect(empty.body.error).toBe("There are no unwatched movies left");

    const watched = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Already Watched" }),
    });
    const eligible = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Only Eligible Movie" }),
    });
    await request(`/api/movies/${watched.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 3, phrase: "Already complete" }),
    });

    const rolled = await request<{
      rolledMovie: { id: string };
      nowShowing: { movie_id: string };
    }>("/api/roll", { method: "POST" });
    expect(rolled.body.rolledMovie.id).toBe(eligible.body.movie.id);
    expect(rolled.body.nowShowing.movie_id).toBe(eligible.body.movie.id);

    const blocked = await request<{ error: string }>("/api/roll", {
      method: "POST",
    });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body.error).toBe(
      "Rate the current movie before rolling again",
    );

    await request(`/api/movies/${eligible.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 4, phrase: "Ready for another roll" }),
    });
    const fresh = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Freshly Eligible Movie" }),
    });
    const rerolled = await request<{
      rolledMovie: { id: string };
      nowShowing: { movie_id: string };
    }>("/api/roll", { method: "POST" });
    expect(rerolled.body.rolledMovie.id).toBe(fresh.body.movie.id);
    expect(rerolled.body.nowShowing.movie_id).toBe(fresh.body.movie.id);
  });

  it("rejects incomplete franchise orders and reports completion", async () => {
    const first = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Order Chapter One",
        franchiseName: "Order Saga",
      }),
    });
    const second = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Order Chapter Two",
        franchiseName: "Order Saga",
      }),
    });
    const catalog = await request<{
      movies: Array<{ franchise_id: string; id: string }>;
    }>("/api/movies");
    const franchiseId = catalog.body.movies[0].franchise_id;
    const orderPath = `/api/franchises/${franchiseId}/order`;

    for (const movieIds of [
      [first.body.movie.id],
      [first.body.movie.id, first.body.movie.id],
      [first.body.movie.id, "00000000-0000-4000-8000-000000000001"],
    ]) {
      const invalid = await request(orderPath, {
        method: "POST",
        body: JSON.stringify({ movieIds }),
      });
      expect(invalid.response.status).toBe(400);
    }

    const invalidIdentifier = await request<{ error: string }>(orderPath, {
      method: "POST",
      body: JSON.stringify({ movieIds: [first.body.movie.id, ""] }),
    });
    expect(invalidIdentifier.response.status).toBe(400);
    expect(invalidIdentifier.body.error).toBe(
      "Order must contain valid movie identifiers",
    );

    const valid = await request(orderPath, {
      method: "POST",
      body: JSON.stringify({
        movieIds: [second.body.movie.id, first.body.movie.id],
      }),
    });
    expect(valid.response.status).toBe(200);

    const roll = await request<{ nowShowing: { movie_id: string } }>(
      "/api/roll",
      { method: "POST" },
    );
    expect(roll.body.nowShowing.movie_id).toBe(second.body.movie.id);
    await request(`/api/movies/${second.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 4, phrase: "First in user order" }),
    });
    const next = await request<{ nowShowing: { movie_id: string } }>(
      "/api/next",
      { method: "POST" },
    );
    expect(next.body.nowShowing.movie_id).toBe(first.body.movie.id);
    await request(`/api/movies/${first.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 4, phrase: "Series complete" }),
    });
    const complete = await request<{ complete: boolean; error: string }>(
      "/api/next",
      { method: "POST" },
    );
    expect(complete.response.status).toBe(409);
    expect(complete.body).toEqual({
      complete: true,
      error: "This franchise is complete",
    });
  });
});
