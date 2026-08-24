import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const migrationSource = (name: string) =>
  readFileSync(`migrations/${name}`, "utf8");

describe("complete TMDB normalization migration", () => {
  it("preserves Library relationships while removing compatibility storage", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const name of migrations.filter(
        (candidate) => candidate < "0013_complete_tmdb_normalization.sql",
      )) {
        database.exec(migrationSource(name));
      }

      database.exec(`
        INSERT INTO users (id, email, created_at)
        VALUES ('user-1', 'user@example.com', '2026-08-01T00:00:00.000Z');

        INSERT INTO collections
          (id, name, name_normalized, order_confirmed, created_at, updated_at)
        VALUES
          ('collection-1', 'Library Collection', 'library collection', 1,
           '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

        INSERT INTO movies
          (id, title, title_normalized, added_at, added_by, updated_at,
           updated_by, release_date, poster_path, tmdb_id, tmdb_fetched_at,
           imdb_id, runtime_minutes, tmdb_collection_id,
           tmdb_collection_name, version, version_runtime,
           version_reference_url)
        VALUES
          ('movie-1', 'Library Title', 'library title',
           '2026-08-01T00:00:00.000Z', 'user-1',
           '2026-08-02T00:00:00.000Z', 'user-1', '2025-01-02',
           '/legacy.jpg', 42, '2026-08-02T00:00:00.000Z', 'tt0000042',
           125, 70, 'Provider Collection', 'Library Cut', 130,
           'https://example.com/library-cut');

        INSERT INTO movie_import_sources
          (source_key, movie_id, source_row, submitted_at, prior_viewed,
           imported_at)
        VALUES
          ('source-1', 'movie-1', 2, '2026-08-01T00:00:00.000Z', 1,
           '2026-08-02T00:00:00.000Z');

        INSERT INTO collection_movies (collection_id, movie_id, position)
        VALUES ('collection-1', 'movie-1', 1);

        INSERT INTO ratings
          (id, movie_id, recorded_at, watched_at, score, phrase, source,
           recorded_by)
        VALUES
          ('rating-1', 'movie-1', '2026-08-03T00:00:00.000Z',
           '2026-08-03T00:00:00.000Z', 4.5, 'Preserved rating',
           'application', 'user-1');

        UPDATE now_showing
        SET rolled_movie_id = 'movie-1', movie_id = 'movie-1',
            collection_id = 'collection-1', status = 'ready',
            rolled_at = '2026-08-02T00:00:00.000Z',
            updated_at = '2026-08-02T00:00:00.000Z'
        WHERE id = 1;

        INSERT INTO rolls
          (id, rolled_movie_id, actual_movie_id, collection_id, created_at,
           actor_id)
        VALUES
          ('roll-1', 'movie-1', 'movie-1', 'collection-1',
           '2026-08-02T00:00:00.000Z', 'user-1');

        INSERT INTO tmdb_people (tmdb_id, name, updated_at, fetched_at)
        VALUES
          (101, 'Preserved Actor', '2026-08-02T00:00:00.000Z',
           '2026-08-02T00:00:00.000Z');

        INSERT INTO movie_credits
          (movie_id, tmdb_person_id, credit_type, position)
        VALUES ('movie-1', 101, 'cast', 1);

        INSERT INTO tmdb_collections (tmdb_id, name, fetched_at)
        VALUES (70, 'Provider Collection', '2026-08-02T00:00:00.000Z');

        INSERT INTO movie_tmdb_data
          (movie_id, tmdb_id, title, release_date, poster_path,
           runtime_minutes, tmdb_collection_id, fetched_at, refresh_after,
           expires_at, data_version, last_refresh_attempt_at,
           last_refresh_status)
        VALUES
          ('movie-1', 42, 'Provider Title', '2025-01-02', '/current.jpg',
           125, 70, '2026-08-02T00:00:00.000Z',
           '2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z', 1,
           '2026-08-02T00:00:00.000Z', 'succeeded');
      `);

      database.exec(
        `BEGIN;\n${migrationSource("0013_complete_tmdb_normalization.sql")}\nCOMMIT;`,
      );

      const movieColumns = database
        .prepare("PRAGMA table_info(movies)")
        .all()
        .map((column) => String(column.name));
      expect(movieColumns).toEqual([
        "id",
        "title",
        "title_normalized",
        "added_at",
        "added_by",
        "updated_at",
        "updated_by",
        "imdb_id",
        "version",
        "version_runtime",
        "version_reference_url",
      ]);
      expect(
        database
          .prepare("PRAGMA table_info(tmdb_people)")
          .all()
          .map((column) => String(column.name)),
      ).toEqual(["tmdb_id", "name", "fetched_at"]);

      expect(
        database
          .prepare(
            `SELECT movies.title, movies.imdb_id, movies.version,
                    movie_tmdb_data.title AS provider_title,
                    movie_tmdb_data.tmdb_id, tmdb_people.name AS actor,
                    tmdb_collections.name AS provider_collection,
                    ratings.phrase, collection_movies.position,
                    movie_import_sources.source_key, now_showing.status,
                    rolls.id AS roll_id
             FROM movies
             JOIN movie_tmdb_data ON movie_tmdb_data.movie_id = movies.id
             JOIN movie_credits ON movie_credits.movie_id = movies.id
             JOIN tmdb_people
               ON tmdb_people.tmdb_id = movie_credits.tmdb_person_id
             JOIN tmdb_collections
               ON tmdb_collections.tmdb_id = movie_tmdb_data.tmdb_collection_id
             JOIN ratings ON ratings.movie_id = movies.id
             JOIN collection_movies ON collection_movies.movie_id = movies.id
             JOIN movie_import_sources
               ON movie_import_sources.movie_id = movies.id
             JOIN now_showing ON now_showing.movie_id = movies.id
             JOIN rolls ON rolls.actual_movie_id = movies.id`,
          )
          .get(),
      ).toMatchObject({
        actor: "Preserved Actor",
        imdb_id: "tt0000042",
        phrase: "Preserved rating",
        position: 1,
        provider_collection: "Provider Collection",
        provider_title: "Provider Title",
        roll_id: "roll-1",
        source_key: "source-1",
        status: "ready",
        title: "Library Title",
        tmdb_id: 42,
        version: "Library Cut",
      });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
