import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";

const app = createApp();
const timestamp = "2026-08-06T00:00:00.000Z";

const request = (path: string, body?: unknown, method = "POST") =>
  app.fetch(
    new Request(`https://ludovico-tech.test/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );

const insertMovie = async (id: string, title: string) => {
  await env.DB.prepare(
    `INSERT INTO movies (id, title, added_at)
     VALUES (?, ?, ?)`,
  )
    .bind(id, title, timestamp)
    .run();
};

const withRejectedAudits = async (operation: () => Promise<void>) => {
  await env.DB.prepare(
    `CREATE TRIGGER reject_audit_insert
     BEFORE INSERT ON audit_log
     BEGIN
       SELECT RAISE(ABORT, 'forced audit failure');
     END`,
  ).run();
  try {
    await operation();
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_audit_insert").run();
  }
};

describe("atomic catalog mutations", () => {
  it("rolls back movie and collection creation when its audit fails", async () => {
    await withRejectedAudits(async () => {
      const response = await request("/movies", {
        title: "Atomic Creation",
        collectionName: "Atomic Collection",
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Internal server error",
      });
    });

    const movie = await env.DB.prepare("SELECT id FROM movies WHERE title = ?")
      .bind("Atomic Creation")
      .first();
    const collection = await env.DB.prepare(
      "SELECT id FROM collections WHERE name = ?",
    )
      .bind("Atomic Collection")
      .first();
    expect(movie).toBeNull();
    expect(collection).toBeNull();
  });

  it("rolls back rating and Now Showing completion when its audit fails", async () => {
    const movieId = "10000000-0000-4000-8000-000000000001";
    await insertMovie(movieId, "Atomic Rating");
    await env.DB.prepare(
      `UPDATE now_showing
       SET movie_id = ?, rolled_movie_id = ?, status = 'ready', updated_at = ?
       WHERE id = 1`,
    )
      .bind(movieId, movieId, timestamp)
      .run();

    await withRejectedAudits(async () => {
      const response = await request(`/movies/${movieId}/rate`, {
        score: 4.5,
        phrase: "Should roll back",
      });
      expect(response.status).toBe(500);
    });

    const rating = await env.DB.prepare(
      "SELECT movie_id FROM ratings WHERE movie_id = ?",
    )
      .bind(movieId)
      .first();
    const state = await env.DB.prepare(
      "SELECT movie_id, status FROM now_showing WHERE id = 1",
    ).first<{ movie_id: string; status: string }>();
    expect(rating).toBeNull();
    expect(state).toEqual({ movie_id: movieId, status: "ready" });
  });

  it("rolls back a movie edit when its audit fails", async () => {
    const movieId = "10000000-0000-4000-8000-000000000005";
    await insertMovie(movieId, "Original Atomic Title");

    await withRejectedAudits(async () => {
      const response = await request(
        `/movies/${movieId}`,
        {
          collectionName: "Atomic Edit Collection",
          title: "Changed Atomic Title",
        },
        "PATCH",
      );
      expect(response.status).toBe(500);
    });

    const movie = await env.DB.prepare("SELECT title FROM movies WHERE id = ?")
      .bind(movieId)
      .first<{ title: string }>();
    expect(movie?.title).toBe("Original Atomic Title");
    expect(
      await env.DB.prepare(
        "SELECT id FROM collections WHERE name = 'Atomic Edit Collection'",
      ).first(),
    ).toBeNull();
  });

  it("rolls back deletion and its reference cleanup when its audit fails", async () => {
    const movieId = "10000000-0000-4000-8000-000000000006";
    await insertMovie(movieId, "Atomic Deletion");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rolls
         (id, rolled_movie_id, actual_movie_id, created_at)
         VALUES ('atomic-delete-roll', ?, ?, ?)`,
      ).bind(movieId, movieId, timestamp),
      env.DB.prepare(
        `UPDATE now_showing
         SET movie_id = ?, rolled_movie_id = ?, status = 'ready', updated_at = ?
         WHERE id = 1`,
      ).bind(movieId, movieId, timestamp),
    ]);

    await withRejectedAudits(async () => {
      const response = await request(`/movies/${movieId}`, undefined, "DELETE");
      expect(response.status).toBe(500);
    });

    expect(
      await env.DB.prepare("SELECT id FROM movies WHERE id = ?")
        .bind(movieId)
        .first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT id FROM rolls WHERE id = 'atomic-delete-roll'",
      ).first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT movie_id, status FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({ movie_id: movieId, status: "ready" });
  });

  it("rolls back a random roll when its audit fails", async () => {
    const movieId = "10000000-0000-4000-8000-000000000002";
    await insertMovie(movieId, "Atomic Roll");
    await env.DB.prepare(
      `UPDATE now_showing
       SET movie_id = NULL, rolled_movie_id = NULL, collection_id = NULL,
           status = 'empty', updated_at = ?
       WHERE id = 1`,
    )
      .bind(timestamp)
      .run();

    await withRejectedAudits(async () => {
      const response = await request("/roll");
      expect(response.status).toBe(500);
    });

    const rollCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rolls WHERE rolled_movie_id = ?",
    )
      .bind(movieId)
      .first<{ count: number }>();
    const state = await env.DB.prepare(
      "SELECT movie_id, status FROM now_showing WHERE id = 1",
    ).first<{ movie_id: string | null; status: string }>();
    expect(rollCount?.count).toBe(0);
    expect(state).toEqual({ movie_id: null, status: "empty" });
  });

  it("rolls back collection order and pending selection when its audit fails", async () => {
    const collectionId = "20000000-0000-4000-8000-000000000001";
    const firstId = "20000000-0000-4000-8000-000000000002";
    const secondId = "20000000-0000-4000-8000-000000000003";
    await env.DB.prepare(
      `INSERT INTO collections
       (id, name, name_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(collectionId, "Atomic Order", "atomic order", timestamp, timestamp)
      .run();
    await insertMovie(firstId, "Atomic Order One");
    await insertMovie(secondId, "Atomic Order Two");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(collectionId, firstId, 1),
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(collectionId, secondId, 2),
      env.DB.prepare(
        `UPDATE now_showing
         SET movie_id = ?, rolled_movie_id = ?, collection_id = ?,
             status = 'pending_order', updated_at = ?
         WHERE id = 1`,
      ).bind(firstId, firstId, collectionId, timestamp),
    ]);

    await withRejectedAudits(async () => {
      const response = await request(`/collections/${collectionId}/order`, {
        movieIds: [secondId, firstId],
      });
      expect(response.status).toBe(500);
    });

    const membership = await env.DB.prepare(
      `SELECT movie_id, position FROM collection_movies
       WHERE collection_id = ? ORDER BY position`,
    )
      .bind(collectionId)
      .all<{ movie_id: string; position: number }>();
    const collection = await env.DB.prepare(
      "SELECT order_confirmed FROM collections WHERE id = ?",
    )
      .bind(collectionId)
      .first<{ order_confirmed: number }>();
    const state = await env.DB.prepare(
      "SELECT movie_id, status FROM now_showing WHERE id = 1",
    ).first<{ movie_id: string; status: string }>();
    expect(membership.results).toEqual([
      { movie_id: firstId, position: 1 },
      { movie_id: secondId, position: 2 },
    ]);
    expect(collection?.order_confirmed).toBe(0);
    expect(state).toEqual({ movie_id: firstId, status: "pending_order" });
  });

  it("rolls back collection continuation when its audit fails", async () => {
    const collectionId = "30000000-0000-4000-8000-000000000001";
    const currentId = "30000000-0000-4000-8000-000000000002";
    const nextId = "30000000-0000-4000-8000-000000000003";
    await env.DB.prepare(
      `INSERT INTO collections
       (id, name, name_normalized, order_confirmed, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        collectionId,
        "Atomic Continuation",
        "atomic continuation",
        timestamp,
        timestamp,
      )
      .run();
    await insertMovie(currentId, "Atomic Continuation One");
    await insertMovie(nextId, "Atomic Continuation Two");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(collectionId, currentId, 1),
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(collectionId, nextId, 2),
      env.DB.prepare(
        `INSERT INTO ratings (movie_id, watched_at, score, phrase)
         VALUES (?, ?, ?, ?)`,
      ).bind(currentId, timestamp, 4, "Ready to continue"),
      env.DB.prepare(
        `UPDATE now_showing
         SET movie_id = ?, rolled_movie_id = ?, collection_id = ?,
             status = 'watched', updated_at = ?
         WHERE id = 1`,
      ).bind(currentId, currentId, collectionId, timestamp),
    ]);

    await withRejectedAudits(async () => {
      const response = await request("/next");
      expect(response.status).toBe(500);
    });

    const state = await env.DB.prepare(
      "SELECT movie_id, status FROM now_showing WHERE id = 1",
    ).first<{ movie_id: string; status: string }>();
    expect(state).toEqual({ movie_id: currentId, status: "watched" });
  });

  it("allows only one concurrent random roll to commit", async () => {
    await insertMovie(
      "40000000-0000-4000-8000-000000000001",
      "Concurrent Roll",
    );
    const [first, second] = await Promise.all([
      request("/roll"),
      request("/roll"),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const rollCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rolls",
    ).first<{ count: number }>();
    const auditCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'rolled'",
    ).first<{ count: number }>();
    const state = await env.DB.prepare(
      "SELECT status FROM now_showing WHERE id = 1",
    ).first<{ status: string }>();
    expect(rollCount?.count).toBe(1);
    expect(auditCount?.count).toBe(1);
    expect(state?.status).toBe("ready");
  });
});
