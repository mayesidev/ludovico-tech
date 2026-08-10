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

  it("persists a collection order and advances to the next movie", async () => {
    const first = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Integration Chapter One",
        collectionName: "Integration Saga",
      }),
    });
    const second = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Integration Chapter Two",
        collectionName: "Integration Saga",
      }),
    });

    const rolled = await request<{
      needsOrder: boolean;
      collectionMovies: Array<{ id: string }>;
    }>("/api/roll", { method: "POST" });
    expect(rolled.response.status).toBe(200);
    expect(rolled.body.needsOrder).toBe(true);
    expect(
      rolled.body.collectionMovies.map((movie) => movie.id).sort(),
    ).toEqual([first.body.movie.id, second.body.movie.id].sort());

    const collectionId = (
      await request<{ movies: Array<{ id: string; collection_id: string }> }>(
        "/api/movies",
      )
    ).body.movies[0].collection_id;
    const ordered = await request<{
      nowShowing: { movie_id: string; status: string };
    }>(`/api/collections/${collectionId}/order`, {
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

  it("moves and removes collection membership while keeping Now Showing consistent", async () => {
    const target = await request<{
      movie: { collection_id: string; id: string };
    }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Existing Replacement Chapter",
        collectionName: "Replacement Saga",
      }),
    });
    const added = await request<{
      movie: { collection_id: string; id: string };
    }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Editable Chapter",
        collectionName: "Original Saga",
      }),
    });
    const originalCollectionId = added.body.movie.collection_id;
    await env.DB.prepare(
      `UPDATE now_showing
       SET movie_id = ?, rolled_movie_id = ?, collection_id = ?, status = 'pending_order'
       WHERE id = 1`,
    )
      .bind(added.body.movie.id, added.body.movie.id, originalCollectionId)
      .run();

    const moved = await request<{
      movie: { collection_id: string; collection_name: string };
    }>(`/api/movies/${added.body.movie.id}`, {
      method: "PATCH",
      body: JSON.stringify({ collectionName: "Replacement Saga" }),
    });
    expect(moved.response.status).toBe(200);
    expect(moved.body.movie.collection_name).toBe("Replacement Saga");
    expect(moved.body.movie.collection_id).toBe(
      target.body.movie.collection_id,
    );
    expect(
      await env.DB.prepare("SELECT id FROM collections WHERE id = ?")
        .bind(originalCollectionId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT collection_id, status FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({
      collection_id: moved.body.movie.collection_id,
      status: "pending_order",
    });
    expect(
      (
        await env.DB.prepare(
          `SELECT movie_id, position FROM collection_movies
           WHERE collection_id = ? ORDER BY position`,
        )
          .bind(target.body.movie.collection_id)
          .all()
      ).results,
    ).toEqual([
      { movie_id: target.body.movie.id, position: 1 },
      { movie_id: added.body.movie.id, position: 2 },
    ]);

    const removed = await request<{
      movie: { collection_id: null; collection_name: null };
    }>(`/api/movies/${added.body.movie.id}`, {
      method: "PATCH",
      body: JSON.stringify({ collectionName: "" }),
    });
    expect(removed.response.status).toBe(200);
    expect(removed.body.movie).toMatchObject({
      collection_id: null,
      collection_name: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT collection_id, status FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({ collection_id: null, status: "ready" });
    expect(
      await env.DB.prepare("SELECT id FROM collections WHERE id = ?")
        .bind(target.body.movie.collection_id)
        .first(),
    ).not.toBeNull();
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

    const missingCollection = await request("/api/collections/missing");
    const missingEdit = await request("/api/movies/missing", {
      method: "PATCH",
      body: JSON.stringify({ title: "Still missing" }),
    });
    const missingRating = await request("/api/movies/missing/rate", {
      method: "POST",
      body: JSON.stringify({ score: 5, phrase: "Still missing" }),
    });
    const missingDelete = await request("/api/movies/missing", {
      method: "DELETE",
    });
    expect([
      missingCollection.response.status,
      missingEdit.response.status,
      missingRating.response.status,
      missingDelete.response.status,
    ]).toEqual([404, 404, 404, 404]);
  });

  it("deletes only unwatched movies and cleans catalog references atomically", async () => {
    const candidate = await request<{
      movie: { collection_id: string; id: string };
    }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Deletion Candidate",
        collectionName: "Deletion Saga",
      }),
    });
    const sibling = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Deletion Sibling",
        collectionName: "Deletion Saga",
      }),
    });
    const collectionId = candidate.body.movie.collection_id;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO movie_import_sources
         (source_key, movie_id, source_row, submitted_at, prior_viewed, imported_at)
         VALUES ('delete-source', ?, 1, datetime('now'), 0, datetime('now'))`,
      ).bind(candidate.body.movie.id),
      env.DB.prepare(
        `INSERT INTO rolls
         (id, rolled_movie_id, actual_movie_id, collection_id, created_at)
         VALUES ('delete-roll', ?, ?, ?, datetime('now'))`,
      ).bind(candidate.body.movie.id, candidate.body.movie.id, collectionId),
      env.DB.prepare(
        `UPDATE now_showing
         SET rolled_movie_id = ?, movie_id = ?, collection_id = ?, status = 'ready'
         WHERE id = 1`,
      ).bind(candidate.body.movie.id, candidate.body.movie.id, collectionId),
    ]);

    const deleted = await request<{ deleted: true; id: string }>(
      `/api/movies/${candidate.body.movie.id}`,
      { method: "DELETE" },
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({
      deleted: true,
      id: candidate.body.movie.id,
    });
    expect(
      await env.DB.prepare("SELECT id FROM movies WHERE id = ?")
        .bind(candidate.body.movie.id)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT source_key FROM movie_import_sources WHERE source_key = 'delete-source'",
      ).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT id FROM rolls WHERE id = 'delete-roll'",
      ).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT movie_id, rolled_movie_id, collection_id, status FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({
      collection_id: null,
      movie_id: null,
      rolled_movie_id: null,
      status: "empty",
    });
    expect(
      await env.DB.prepare("SELECT id FROM collections WHERE id = ?")
        .bind(collectionId)
        .first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT action FROM audit_log WHERE entity_id = ? AND action = 'deleted'",
      )
        .bind(candidate.body.movie.id)
        .first(),
    ).toEqual({ action: "deleted" });

    const orphaned = await request(`/api/movies/${sibling.body.movie.id}`, {
      method: "DELETE",
    });
    expect(orphaned.response.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT id FROM collections WHERE id = ?")
        .bind(collectionId)
        .first(),
    ).toBeNull();

    const watched = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({ title: "Protected Watched Movie" }),
    });
    await request(`/api/movies/${watched.body.movie.id}/rate`, {
      method: "POST",
      body: JSON.stringify({ score: 3.5, phrase: "Must be retained" }),
    });
    const rejected = await request<{ error: string }>(
      `/api/movies/${watched.body.movie.id}`,
      { method: "DELETE" },
    );
    expect(rejected.response.status).toBe(409);
    expect(rejected.body.error).toBe("Watched movies cannot be deleted");
    expect(
      await env.DB.prepare("SELECT id FROM movies WHERE id = ?")
        .bind(watched.body.movie.id)
        .first(),
    ).not.toBeNull();
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

  it("rejects incomplete collection orders and reports completion", async () => {
    const first = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Order Chapter One",
        collectionName: "Order Saga",
      }),
    });
    const second = await request<{ movie: { id: string } }>("/api/movies", {
      method: "POST",
      body: JSON.stringify({
        title: "Order Chapter Two",
        collectionName: "Order Saga",
      }),
    });
    const catalog = await request<{
      movies: Array<{ collection_id: string; id: string }>;
    }>("/api/movies");
    const collectionId = catalog.body.movies[0].collection_id;
    const orderPath = `/api/collections/${collectionId}/order`;

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
      body: JSON.stringify({ score: 4, phrase: "Collection complete" }),
    });
    const complete = await request<{ complete: boolean; error: string }>(
      "/api/next",
      { method: "POST" },
    );
    expect(complete.response.status).toBe(409);
    expect(complete.body).toEqual({
      complete: true,
      error: "This collection is complete",
    });
  });
});
