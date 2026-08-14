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

  it("keeps version details attached to a TMDB movie and a named version", async () => {
    await insertMovie("movie-valid-version");
    await env.DB.prepare(
      `UPDATE movies
       SET tmdb_id = ?, version = ?, version_runtime = ?, version_reference_url = ?
       WHERE id = ?`,
    )
      .bind(
        42,
        "Director's Cut",
        112,
        "https://example.com/cuts/42",
        "movie-valid-version",
      )
      .run();

    await insertMovie("movie-version-without-tmdb");
    await expect(
      env.DB.prepare("UPDATE movies SET version = ? WHERE id = ?")
        .bind("Director's Cut", "movie-version-without-tmdb")
        .run(),
    ).rejects.toThrow();

    await insertMovie("movie-details-without-version");
    await expect(
      env.DB.prepare(
        "UPDATE movies SET tmdb_id = ?, version_runtime = ? WHERE id = ?",
      )
        .bind(43, 100, "movie-details-without-version")
        .run(),
    ).rejects.toThrow();

    await insertMovie("movie-invalid-version-runtime");
    await expect(
      env.DB.prepare(
        "UPDATE movies SET tmdb_id = ?, version = ?, version_runtime = ? WHERE id = ?",
      )
        .bind(44, "Extended Edition", 0, "movie-invalid-version-runtime")
        .run(),
    ).rejects.toThrow();

    await insertMovie("movie-invalid-version-url");
    await expect(
      env.DB.prepare(
        "UPDATE movies SET tmdb_id = ?, version = ?, version_reference_url = ? WHERE id = ?",
      )
        .bind(
          45,
          "Fan Edit",
          "file:///private/edit.mkv",
          "movie-invalid-version-url",
        )
        .run(),
    ).rejects.toThrow();
  });

  it("enforces positive unique collection positions and one membership per movie", async () => {
    await env.DB.prepare(
      `INSERT INTO collections
       (id, name, name_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        "collection-one",
        "Example Collection",
        "example collection",
        "2026-08-06T00:00:00.000Z",
        "2026-08-06T00:00:00.000Z",
      )
      .run();
    await insertMovie("collection-movie-one");
    await insertMovie("collection-movie-two");
    await env.DB.prepare(
      "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
    )
      .bind("collection-one", "collection-movie-one", 1)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      )
        .bind("collection-one", "collection-movie-two", 1)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      )
        .bind("collection-one", "collection-movie-two", 0)
        .run(),
    ).rejects.toThrow();
  });

  it("migrates a pending collection selection to the earliest-added unwatched movie", async () => {
    await env.DB.prepare(
      `INSERT INTO collections
       (id, name, name_normalized, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        "collection-default-order",
        "Default Order Collection",
        "default order collection",
        "2026-08-06T00:00:00.000Z",
        "2026-08-06T00:00:00.000Z",
      )
      .run();
    await insertMovie("movie-added-later");
    await insertMovie("movie-added-earlier");
    await env.DB.batch([
      env.DB.prepare("UPDATE movies SET added_at = ? WHERE id = ?").bind(
        "2026-08-02T00:00:00.000Z",
        "movie-added-later",
      ),
      env.DB.prepare("UPDATE movies SET added_at = ? WHERE id = ?").bind(
        "2026-08-01T00:00:00.000Z",
        "movie-added-earlier",
      ),
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind("collection-default-order", "movie-added-later", 1),
      env.DB.prepare(
        "INSERT INTO collection_movies (collection_id, movie_id, position) VALUES (?, ?, ?)",
      ).bind("collection-default-order", "movie-added-earlier", 2),
      env.DB.prepare(
        `UPDATE now_showing
         SET movie_id = ?, rolled_movie_id = ?, collection_id = ?, status = 'pending_order'
         WHERE id = 1`,
      ).bind(
        "movie-added-later",
        "movie-added-later",
        "collection-default-order",
      ),
    ]);

    const migration = env.TEST_MIGRATIONS.find(
      (candidate) => candidate.name === "0005_default_collection_order.sql",
    );
    expect(migration).toBeDefined();
    for (const query of migration?.queries ?? []) {
      await env.DB.prepare(query).run();
    }

    expect(
      await env.DB.prepare(
        "SELECT movie_id, rolled_movie_id, status FROM now_showing WHERE id = 1",
      ).first(),
    ).toEqual({
      movie_id: "movie-added-earlier",
      rolled_movie_id: "movie-added-later",
      status: "ready",
    });
  });

  it("allows only positive movie runtimes when known", async () => {
    await insertMovie("movie-valid-runtime");
    await env.DB.prepare("UPDATE movies SET runtime_minutes = ? WHERE id = ?")
      .bind(123, "movie-valid-runtime")
      .run();
    expect(
      await env.DB.prepare("SELECT runtime_minutes FROM movies WHERE id = ?")
        .bind("movie-valid-runtime")
        .first(),
    ).toEqual({ runtime_minutes: 123 });

    await expect(
      env.DB.prepare("UPDATE movies SET runtime_minutes = 0 WHERE id = ?")
        .bind("movie-valid-runtime")
        .run(),
    ).rejects.toThrow();
  });

  it("uses a unique first-class IMDb identity column", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(movies)").all<{
      name: string;
    }>();
    expect(columns.results.map(({ name }) => name)).toContain("imdb_id");
    expect(columns.results.map(({ name }) => name)).not.toContain(
      "legacy_imdb_id",
    );

    await insertMovie("movie-imdb-one");
    await insertMovie("movie-imdb-two");
    await env.DB.prepare("UPDATE movies SET imdb_id = ? WHERE id = ?")
      .bind("tt0117509", "movie-imdb-one")
      .run();
    await expect(
      env.DB.prepare("UPDATE movies SET imdb_id = ? WHERE id = ?")
        .bind("tt0117509", "movie-imdb-two")
        .run(),
    ).rejects.toThrow();
  });

  it("keeps TMDB collection identifiers and names paired", async () => {
    await insertMovie("movie-tmdb-collection");
    await expect(
      env.DB.prepare("UPDATE movies SET tmdb_collection_id = 7 WHERE id = ?")
        .bind("movie-tmdb-collection")
        .run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "UPDATE movies SET tmdb_collection_id = 7, tmdb_collection_name = 'Provider Collection' WHERE id = ?",
    )
      .bind("movie-tmdb-collection")
      .run();
    expect(
      await env.DB.prepare(
        "SELECT tmdb_collection_id, tmdb_collection_name FROM movies WHERE id = ?",
      )
        .bind("movie-tmdb-collection")
        .first(),
    ).toEqual({
      tmdb_collection_id: 7,
      tmdb_collection_name: "Provider Collection",
    });
  });

  it("keeps source provenance and actor identifiers out of public movie DTOs", async () => {
    await insertMovie("movie-public", "Public Movie");
    await env.DB.prepare("UPDATE movies SET imdb_id = ? WHERE id = ?")
      .bind("tt0117509", "movie-public")
      .run();
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
    expect(movie).toHaveProperty("imdb_id", "tt0117509");
    expect(movie).not.toHaveProperty("tmdb_fetched_at");
    expect(movie).not.toHaveProperty("source_key");
    expect(movie).not.toHaveProperty("source_row");
    expect(movie).not.toHaveProperty("prior_viewed");
  });
});
