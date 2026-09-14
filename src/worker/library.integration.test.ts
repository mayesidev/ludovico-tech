import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";

type Library = {
  movies: Array<{ id: string }>;
  counts: { total: number; unwatched: number };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

const app = createApp();
const requestLibrary = async (query = "") => {
  const usage: D1Meta[] = [];
  const track = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => track(target.bind(...values));
        }
        if (property === "first" || property === "all") {
          return async () => {
            // Library first() queries aggregate to one row; all() exposes the
            // same query's actual local D1 usage metadata for these assertions.
            const result = await target.all();
            usage.push(result.meta);
            return property === "first" ? (result.results[0] ?? null) : result;
          };
        }
        return Reflect.get(target, property, target);
      },
    });
  const database = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => track(target.prepare(sql));
      }
      return Reflect.get(target, property, target);
    },
  });
  const response = await app.fetch(
    new Request(`https://ludovico-tech.test/api/library${query}`),
    { ...env, DB: database },
  );
  expect(response.status).toBe(200);
  return { body: (await response.json()) as Library, usage };
};

const seedMovies = async (count: number) => {
  if (!count) return;
  await env.DB.prepare(
    `WITH RECURSIVE sequence(n) AS (
       SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < ?
     )
     INSERT INTO movies (id, title, added_at)
     SELECT printf('library-%04d', n), printf('Library Movie %04d', n),
            '2026-09-01T00:00:00.000Z'
     FROM sequence`,
  )
    .bind(count)
    .run();
};

describe("Library counts and read costs", () => {
  it("preserves counts through rating, unrating, deletion, and new movies", async () => {
    const assertCounts = async (total: number, unwatched: number) => {
      for (const status of ["all", "watched", "unwatched"]) {
        const { body } = await requestLibrary(`?status=${status}`);
        expect(body.counts).toEqual({ total, unwatched });
        expect(body.pagination.total).toBe(
          status === "all"
            ? total
            : status === "watched"
              ? total - unwatched
              : unwatched,
        );
      }
    };
    await assertCounts(0, 0);
    await seedMovies(3);
    await assertCounts(3, 3);
    await env.DB.prepare(
      `INSERT INTO ratings (movie_id, score, phrase)
       VALUES ('library-0002', 4, 'First rating')`,
    ).run();
    await assertCounts(3, 2);
    await env.DB.prepare(
      `UPDATE ratings SET score = 5, phrase = 'Revised rating'
       WHERE movie_id = 'library-0002'`,
    ).run();
    await assertCounts(3, 2);
    await env.DB.prepare("DELETE FROM movies WHERE id = 'library-0001'").run();
    await assertCounts(2, 1);
    await env.DB.prepare(
      "DELETE FROM ratings WHERE movie_id = 'library-0002'",
    ).run();
    await assertCounts(2, 2);
    await env.DB.prepare(
      `INSERT INTO ratings (movie_id, score, phrase)
       SELECT id, 4, 'All watched' FROM movies`,
    ).run();
    await assertCounts(2, 0);
    await env.DB.prepare("DELETE FROM movies WHERE id = 'library-0002'").run();
    await assertCounts(1, 0);
    await env.DB.prepare(
      `INSERT INTO movies (id, title, added_at)
       VALUES ('new-movie', 'New Movie', '2026-09-02T00:00:00.000Z')`,
    ).run();
    await assertCounts(2, 1);
    await env.DB.prepare("DELETE FROM movies").run();
    await assertCounts(0, 0);
  });

  it.each([200, 2000])(
    "reduces count reads in a %i-movie catalog",
    async (count) => {
      await seedMovies(count);
      await env.DB.prepare(
        `INSERT INTO ratings (movie_id, score, phrase)
       SELECT id, 4, 'Watched' FROM movies WHERE rowid % 5 IN (0, 1)`,
      ).run();
      const previousCounts = await env.DB.prepare(
        `SELECT COUNT(*) AS total,
         SUM(CASE WHEN ratings.movie_id IS NULL THEN 1 ELSE 0 END) AS unwatched
       FROM movies LEFT JOIN ratings ON ratings.movie_id = movies.id`,
      ).all();
      const { body, usage } = await requestLibrary();
      expect(body.counts).toEqual(previousCounts.results[0]);
      expect(body.movies).toHaveLength(50);
      expect(body.pagination).toEqual({
        page: 1,
        pageSize: 50,
        total: count,
        totalPages: count / 50,
      });
      expect(usage[0].rows_read).toBeLessThan(
        previousCounts.meta.rows_read / 2,
      );
      expect(usage.every((entry) => entry.rows_written === 0)).toBe(true);
    },
  );
});
