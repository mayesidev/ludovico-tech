import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getWatchedHistory } from "./db";

const rate = async (movieId: string, score: number, phrase: string) => {
  const response = await exports.default.fetch(
    new Request(`https://ludovico-tech.test/api/movies/${movieId}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, phrase }),
    }),
  );
  expect(response.status).toBe(200);
  return env.DB.prepare(
    "SELECT watched_at, score, phrase, recorded_at, recorded_by FROM ratings WHERE movie_id = ?",
  )
    .bind(movieId)
    .first<{
      watched_at: string | null;
      score: number;
      phrase: string;
      recorded_at: string;
      recorded_by: string;
    }>();
};

describe("rating watch history", () => {
  it.each([null, "2020-01-02T12:00:00.000Z"])(
    "preserves an existing watch time of %s when correcting its rating",
    async (watchedAt) => {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO movies (id, title, added_at)
           VALUES ('historical', 'Historical Movie', '2020-01-01'),
                  ('latest', 'Latest Known Watch', '2021-01-01')`,
        ),
        env.DB.prepare(
          `INSERT INTO ratings (movie_id, watched_at, score, phrase)
           VALUES ('historical', ?, 2, 'Original'),
                  ('latest', '2021-01-02T12:00:00.000Z', 4, 'Latest')`,
        ).bind(watchedAt),
      ]);
      const before = Date.now();
      const corrected = await rate("historical", 5, "Corrected");
      expect(corrected).toMatchObject({
        watched_at: watchedAt,
        score: 5,
        phrase: "Corrected",
      });
      expect(Date.parse(corrected!.recorded_at)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(corrected!.recorded_at)).toBeLessThanOrEqual(
        Date.now(),
      );
      expect(corrected!.recorded_by).toBeTruthy();
      expect((await getWatchedHistory(env))[0].id).toBe("latest");
    },
  );

  it("timestamps a first rating and retains that time on later corrections", async () => {
    await env.DB.prepare(
      `INSERT INTO movies (id, title, added_at)
       VALUES ('first-watch', 'First Watch', '2020-01-01')`,
    ).run();
    const before = Date.now();
    const first = await rate("first-watch", 3, "First rating");
    expect(first!.watched_at).toBe(first!.recorded_at);
    expect(Date.parse(first!.watched_at!)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(first!.watched_at!)).toBeLessThanOrEqual(Date.now());
    const corrected = await rate("first-watch", 4, "Corrected");
    expect(corrected!.watched_at).toBe(first!.watched_at);
    expect(corrected!.recorded_by).toBe(first!.recorded_by);
    expect((await getWatchedHistory(env))[0].id).toBe("first-watch");
  });
});
