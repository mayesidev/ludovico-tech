import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";

const insertMovie = async (id: string, title = id) => {
  await env.DB.prepare(
    `INSERT INTO movies (id, title, title_normalized, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      title,
      title.toLowerCase(),
      "2026-08-06T00:00:00.000Z",
      "2026-08-06T00:00:00.000Z",
    )
    .run();
};

describe("catalog schema", () => {
  it("bootstraps a complete empty catalog without source data", async () => {
    const movieCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM movies",
    ).first<{ count: number }>();
    const nowShowing = await env.DB.prepare(
      "SELECT status, movie_id FROM now_showing WHERE id = 1",
    ).first<{ status: string; movie_id: string | null }>();

    expect(movieCount?.count).toBe(0);
    expect(nowShowing).toEqual({ status: "empty", movie_id: null });
  });

  it("enforces one shared half-point rating with a required phrase", async () => {
    await insertMovie("movie-valid-rating");
    await env.DB.prepare(
      `INSERT INTO ratings
       (id, movie_id, recorded_at, score, phrase, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "rating-valid",
        "movie-valid-rating",
        "2026-08-06T00:00:00.000Z",
        4.5,
        "Four and a half tiny hats",
        "application",
      )
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO ratings
         (id, movie_id, recorded_at, score, phrase, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "rating-duplicate",
          "movie-valid-rating",
          "2026-08-06T00:00:00.000Z",
          3,
          "A second opinion",
          "application",
        )
        .run(),
    ).rejects.toThrow();

    for (const [index, score] of [-0.5, 1.25, 5.5].entries()) {
      const movieId = `movie-invalid-score-${index}`;
      await insertMovie(movieId);
      await expect(
        env.DB.prepare(
          `INSERT INTO ratings
           (id, movie_id, recorded_at, score, phrase, source)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            `rating-invalid-score-${index}`,
            movieId,
            "2026-08-06T00:00:00.000Z",
            score,
            "Invalid score",
            "application",
          )
          .run(),
      ).rejects.toThrow();
    }

    await insertMovie("movie-blank-phrase");
    await expect(
      env.DB.prepare(
        `INSERT INTO ratings
         (id, movie_id, recorded_at, score, phrase, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "rating-blank-phrase",
          "movie-blank-phrase",
          "2026-08-06T00:00:00.000Z",
          0,
          "   ",
          "application",
        )
        .run(),
    ).rejects.toThrow();
  });

  it("enforces positive unique franchise positions and one membership per movie", async () => {
    await env.DB.prepare(
      `INSERT INTO franchises
       (id, name, name_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        "franchise-one",
        "Example Series",
        "example series",
        "2026-08-06T00:00:00.000Z",
        "2026-08-06T00:00:00.000Z",
      )
      .run();
    await insertMovie("franchise-movie-one");
    await insertMovie("franchise-movie-two");
    await env.DB.prepare(
      "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
    )
      .bind("franchise-one", "franchise-movie-one", 1)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
      )
        .bind("franchise-one", "franchise-movie-two", 1)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)",
      )
        .bind("franchise-one", "franchise-movie-two", 0)
        .run(),
    ).rejects.toThrow();
  });

  it("keeps source provenance and actor identifiers out of public movie DTOs", async () => {
    await insertMovie("movie-public", "Public Movie");
    await env.DB.prepare(
      `INSERT INTO movie_import_sources
       (source_key, movie_id, source_row, submitted_at, prior_viewed, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "private-source-key",
        "movie-public",
        2,
        "2026-08-06T00:00:00.000Z",
        1,
        "2026-08-06T00:00:00.000Z",
      )
      .run();

    const response = await createApp().fetch(
      new Request("https://ludovico-tech.test/api/movies"),
      env,
    );
    const body = (await response.json()) as {
      movies: Array<Record<string, unknown>>;
    };
    const movie = body.movies.find((entry) => entry.id === "movie-public");

    expect(response.status).toBe(200);
    expect(movie).toBeDefined();
    expect(movie).not.toHaveProperty("added_by");
    expect(movie).not.toHaveProperty("updated_by");
    expect(movie).not.toHaveProperty("title_normalized");
    expect(movie).not.toHaveProperty("legacy_imdb_id");
    expect(movie).not.toHaveProperty("tmdb_fetched_at");
    expect(movie).not.toHaveProperty("source_key");
    expect(movie).not.toHaveProperty("source_row");
    expect(movie).not.toHaveProperty("prior_viewed");
  });
});
