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
    `INSERT INTO movies (id, title, added_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(id, title, timestamp, timestamp)
    .run();
};

describe("atomic catalog mutations", () => {
  it("rolls back collection creation when its movie insert fails", async () => {
    await env.DB.prepare(
      `CREATE TRIGGER reject_atomic_movie
       BEFORE INSERT ON movies
       WHEN NEW.title = 'Atomic Creation'
       BEGIN SELECT RAISE(ABORT, 'forced movie failure'); END`,
    ).run();
    try {
      const response = await request("/movies", {
        title: "Atomic Creation",
        collectionName: "Atomic Collection",
      });
      expect(response.status).toBe(500);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_atomic_movie").run();
    }
    expect(
      await env.DB.prepare(
        "SELECT id FROM collections WHERE name = 'Atomic Collection'",
      ).first(),
    ).toBeNull();
  });

  it("rolls back a rating when its Now Showing update fails", async () => {
    const movieId = "10000000-0000-4000-8000-000000000001";
    await insertMovie(movieId, "Atomic Rating");
    await env.DB.prepare(
      `UPDATE now_showing SET movie_id = ?, status = 'ready', updated_at = ?
       WHERE id = 1`,
    )
      .bind(movieId, timestamp)
      .run();
    await env.DB.prepare(
      `CREATE TRIGGER reject_watched_state
       BEFORE UPDATE OF status ON now_showing
       WHEN NEW.status = 'watched'
       BEGIN SELECT RAISE(ABORT, 'forced state failure'); END`,
    ).run();
    try {
      const response = await request(`/movies/${movieId}/rate`, {
        score: 4.5,
        phrase: "Should roll back",
      });
      expect(response.status).toBe(500);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_watched_state").run();
    }
    expect(
      await env.DB.prepare("SELECT movie_id FROM ratings WHERE movie_id = ?")
        .bind(movieId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT movie_id, status FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({ movie_id: movieId, status: "ready" });
  });

  it("attributes collection ordering and its selection consequence", async () => {
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
         SET movie_id = ?, collection_id = ?, status = 'pending_order', updated_at = ?
         WHERE id = 1`,
      ).bind(firstId, collectionId, timestamp),
    ]);

    const response = await request(`/collections/${collectionId}/order`, {
      movieIds: [secondId, firstId],
    });
    expect(response.status).toBe(200);
    const attribution = await env.DB.prepare(
      `SELECT collections.updated_by AS collection_attribution,
              now_showing.updated_by AS selection_attribution
       FROM collections JOIN now_showing ON now_showing.collection_id = collections.id
       WHERE collections.id = ?`,
    )
      .bind(collectionId)
      .first<{
        collection_attribution: string;
        selection_attribution: string;
      }>();
    expect(attribution?.collection_attribution).toBeTruthy();
    expect(attribution?.selection_attribution).toBe(
      attribution?.collection_attribution,
    );
  });

  it("allows only one concurrent random roll to update current state", async () => {
    await insertMovie(
      "40000000-0000-4000-8000-000000000001",
      "Concurrent Roll",
    );
    const [first, second] = await Promise.all([
      request("/roll"),
      request("/roll"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const state = await env.DB.prepare(
      "SELECT status, updated_by FROM now_showing WHERE id = 1",
    ).first<{ status: string; updated_by: string | null }>();
    expect(state?.status).toBe("ready");
    expect(state?.updated_by).toBeTruthy();
  });
});
