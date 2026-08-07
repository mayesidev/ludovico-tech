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
    `INSERT INTO movies (id, title, title_normalized, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, title, title.toLowerCase(), timestamp, timestamp)
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
  it("rolls back movie and franchise creation when its audit fails", async () => {
    await withRejectedAudits(async () => {
      const response = await request("/movies", {
        title: "Atomic Creation",
        franchiseName: "Atomic Series",
      });
      expect(response.status).toBe(500);
    });

    const movie = await env.DB.prepare("SELECT id FROM movies WHERE title = ?")
      .bind("Atomic Creation")
      .first();
    const franchise = await env.DB.prepare(
      "SELECT id FROM franchises WHERE name = ?",
    )
      .bind("Atomic Series")
      .first();
    expect(movie).toBeNull();
    expect(franchise).toBeNull();
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
      "SELECT id FROM ratings WHERE movie_id = ?",
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
        { title: "Changed Atomic Title" },
        "PATCH",
      );
      expect(response.status).toBe(500);
    });

    const movie = await env.DB.prepare("SELECT title FROM movies WHERE id = ?")
      .bind(movieId)
      .first<{ title: string }>();
    expect(movie?.title).toBe("Original Atomic Title");
  });

  it("rolls back a random roll when its audit fails", async () => {
    const movieId = "10000000-0000-4000-8000-000000000002";
    await insertMovie(movieId, "Atomic Roll");
    await env.DB.prepare(
      `UPDATE now_showing
       SET movie_id = NULL, rolled_movie_id = NULL, franchise_id = NULL,
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

  it("rolls back franchise order and pending selection when its audit fails", async () => {
    const franchiseId = "20000000-0000-4000-8000-000000000001";
    const firstId = "20000000-0000-4000-8000-000000000002";
    const secondId = "20000000-0000-4000-8000-000000000003";
    await env.DB.prepare(
      `INSERT INTO franchises
       (id, name, name_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(franchiseId, "Atomic Order", "atomic order", timestamp, timestamp)
      .run();
    await insertMovie(firstId, "Atomic Order One");
    await insertMovie(secondId, "Atomic Order Two");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(franchiseId, firstId, 1),
      env.DB.prepare(
        "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(franchiseId, secondId, 2),
      env.DB.prepare(
        `UPDATE now_showing
         SET movie_id = ?, rolled_movie_id = ?, franchise_id = ?,
             status = 'pending_order', updated_at = ?
         WHERE id = 1`,
      ).bind(firstId, firstId, franchiseId, timestamp),
    ]);

    await withRejectedAudits(async () => {
      const response = await request(`/franchises/${franchiseId}/order`, {
        movieIds: [secondId, firstId],
      });
      expect(response.status).toBe(500);
    });

    const membership = await env.DB.prepare(
      `SELECT movie_id, position FROM franchise_movies
       WHERE franchise_id = ? ORDER BY position`,
    )
      .bind(franchiseId)
      .all<{ movie_id: string; position: number }>();
    const franchise = await env.DB.prepare(
      "SELECT order_confirmed FROM franchises WHERE id = ?",
    )
      .bind(franchiseId)
      .first<{ order_confirmed: number }>();
    const state = await env.DB.prepare(
      "SELECT movie_id, status FROM now_showing WHERE id = 1",
    ).first<{ movie_id: string; status: string }>();
    expect(membership.results).toEqual([
      { movie_id: firstId, position: 1 },
      { movie_id: secondId, position: 2 },
    ]);
    expect(franchise?.order_confirmed).toBe(0);
    expect(state).toEqual({ movie_id: firstId, status: "pending_order" });
  });

  it("rolls back franchise continuation when its audit fails", async () => {
    const franchiseId = "30000000-0000-4000-8000-000000000001";
    const currentId = "30000000-0000-4000-8000-000000000002";
    const nextId = "30000000-0000-4000-8000-000000000003";
    await env.DB.prepare(
      `INSERT INTO franchises
       (id, name, name_normalized, order_confirmed, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        franchiseId,
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
        "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(franchiseId, currentId, 1),
      env.DB.prepare(
        "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind(franchiseId, nextId, 2),
      env.DB.prepare(
        `INSERT INTO ratings
         (id, movie_id, recorded_at, watched_at, score, phrase, source)
         VALUES (?, ?, ?, ?, ?, ?, 'application')`,
      ).bind(
        "30000000-0000-4000-8000-000000000004",
        currentId,
        timestamp,
        timestamp,
        4,
        "Ready to continue",
      ),
      env.DB.prepare(
        `UPDATE now_showing
         SET movie_id = ?, rolled_movie_id = ?, franchise_id = ?,
             status = 'watched', updated_at = ?
         WHERE id = 1`,
      ).bind(currentId, currentId, franchiseId, timestamp),
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
    expect(["pending_order", "ready"]).toContain(state?.status);
  });
});
