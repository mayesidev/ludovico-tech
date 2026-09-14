import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";
import { literalSubstringSearch } from "./sqlite-search";
import { normalizeTitle } from "../shared/normalize-title";
import { getTmdbMetadataContractId } from "../shared/tmdb-metadata-contract";

const timestamp = "2026-06-01T12:30:00.000Z";
const app = createApp();
const request = async (path: string, search: string, parameters = {}) => {
  const query = new URLSearchParams({ search, ...parameters });
  const response = await app.fetch(
    new Request(`https://ludovico-tech.test/api${path}?${query}`),
    env,
  );
  const body = (await response.json()) as {
    movies?: Array<{ id: string }>;
    items?: Array<{ movieId: string }>;
    collections?: Array<{ id: string; name: string }>;
    pagination?: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
    queue?: {
      items: Array<{ movieId: string }>;
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    };
  };
  return { status: response.status, body };
};
const movieIds = (body: Awaited<ReturnType<typeof request>>["body"]) =>
  body.movies?.map(({ id }) => id) ??
  (body.items ?? body.queue!.items).map(({ movieId }) => movieId);
const insertMovie = (id: string, title: string) =>
  env.DB.prepare("INSERT INTO movies (id, title, added_at) VALUES (?, ?, ?)")
    .bind(id, title, timestamp)
    .run();
const paths = ["/library", "/tmdb-refresh/items", "/tmdb-refresh/overview"];

describe("D1 literal searches", () => {
  it.each([
    { name: "48 ASCII characters", search: "A".repeat(48) },
    { name: "49 ASCII characters", search: "A".repeat(49) },
    { name: "200 ASCII characters", search: "A".repeat(200) },
    { name: "16 multibyte characters", search: "映".repeat(16) },
    { name: "17 multibyte characters", search: "映".repeat(17) },
    { name: "200 multibyte characters", search: "映".repeat(200) },
    { name: "100 supplementary characters", search: "🎬".repeat(100) },
    { name: "24 literal underscores", search: "_".repeat(24) },
    { name: "25 literal underscores", search: "_".repeat(25) },
    { name: "200 literal percent signs", search: "%".repeat(200) },
    { name: "200 literal backslashes", search: "\\".repeat(200) },
  ])("searches all table endpoints with $name", async ({ search }) => {
    await insertMovie("match", search);
    await insertMovie("other", "Other movie");
    for (const path of paths) {
      const result = await request(path, search);
      expect(result.status, path).toBe(200);
      expect(movieIds(result.body), path).toEqual(["match"]);
      expect(
        (result.body.pagination ?? result.body.queue!.pagination).total,
      ).toBe(1);
    }
  });

  it("preserves the accepted length and empty-result contracts", async () => {
    for (const path of [...paths, "/collections/suggestions"]) {
      expect((await request(path, "A".repeat(200))).status, path).toBe(200);
      expect((await request(path, "A".repeat(201))).status, path).toBe(400);
    }
    await insertMovie("other", "Other movie");
    for (const path of paths) {
      const result = await request(path, "映".repeat(200), { page: "20" });
      expect(result.status, path).toBe(200);
      expect(movieIds(result.body), path).toEqual([]);
      expect(
        result.body.pagination ?? result.body.queue!.pagination,
      ).toMatchObject({
        page: 1,
        total: 0,
        totalPages: 1,
      });
    }
  });

  it("preserves literal matching and SQLite ASCII-only case folding", async () => {
    await env.DB.batch(
      [
        ["literal", "MiXeD 100%_\\ Cinema é"],
        ["wildcard-decoy", "mixed 100xyz Cinema É"],
      ].map(([id, title]) =>
        env.DB.prepare(
          "INSERT INTO movies (id, title, added_at) VALUES (?, ?, ?)",
        ).bind(id, title, timestamp),
      ),
    );
    for (const path of paths) {
      for (const search of ["mIxEd 100%_\\", "%_\\", "é"]) {
        const result = await request(path, search);
        expect(result.status).toBe(200);
        expect(movieIds(result.body)).toEqual(["literal"]);
      }
      expect(movieIds((await request(path, "É")).body)).toEqual([
        "wildcard-decoy",
      ]);
    }
  });

  it("keeps pagination and sorting after a long literal match", async () => {
    const search = "Long matching title ".repeat(4).trim();
    await env.DB.batch(
      Array.from({ length: 26 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO movies (id, title, added_at) VALUES (?, ?, ?)",
        ).bind(
          `movie-${index}`,
          `${String(index).padStart(2, "0")} ${search}`,
          timestamp,
        ),
      ),
    );
    for (const path of paths) {
      const result = await request(path, search, {
        page: "2",
        pageSize: "25",
        sort: "title",
        direction: "desc",
      });
      expect(result.status).toBe(200);
      expect(movieIds(result.body)).toEqual(["movie-0"]);
      expect(result.body.pagination ?? result.body.queue!.pagination).toEqual({
        page: 2,
        pageSize: 25,
        total: 26,
        totalPages: 2,
      });
    }
  });

  it("continues searching every Library field", async () => {
    await insertMovie("fields", "Quiet Movie");
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO movie_tmdb_data
        (movie_id, tmdb_id, release_date, refresh_after)
        VALUES ('fields', 123456, '1999-02-03', '1970-01-01T00:00:00.000Z')`),
      env.DB.prepare(
        "UPDATE movies SET version = 'Extended Cut' WHERE id = 'fields'",
      ),
      env.DB.prepare(
        `INSERT INTO collections (id, name, name_key, created_at, updated_at)
        VALUES ('collection', 'Catalog Saga', 'catalog saga', ?, ?)`,
      ).bind(timestamp, timestamp),
      env.DB
        .prepare(`INSERT INTO collection_memberships (collection_id, movie_id, position)
        VALUES ('collection', 'fields', 1)`),
      env.DB.prepare(`INSERT INTO ratings (movie_id, score, phrase)
        VALUES ('fields', 4.5, 'Phrase_100%')`),
    ]);
    for (const search of [
      "quiet movie extended cut",
      "catalog saga",
      "1999-02-03",
      "2026-06-01",
      "4.5",
      "phrase_100%",
    ]) {
      const result = await request("/library", search, { status: "watched" });
      expect(result.status).toBe(200);
      expect(movieIds(result.body), search).toEqual(["fields"]);
    }
  });

  it("continues searching every Manager field and combining date matches", async () => {
    await insertMovie("fields", "Quiet Movie");
    const contract = await getTmdbMetadataContractId();
    await env.DB.prepare(
      `INSERT INTO movie_tmdb_data
      (movie_id, tmdb_id, fetched_at, expires_at, refresh_after,
       contract_id, last_refresh_attempt_at, last_refresh_status, last_refresh_error)
      VALUES ('fields', 123456, '2026-05-02T10:00:00.000Z', '2099-01-01T00:00:00.000Z',
        '2027-03-04T11:00:00.000Z', ?, '2026-06-03T12:00:00.000Z', 'failed', 'Error_100%')`,
    )
      .bind(contract)
      .run();
    for (const path of paths.slice(1)) {
      for (const search of [
        "quiet",
        "123456",
        "failed",
        "Error_100%",
        "2026-05-02",
        "2026-06-03",
        "2027-03-04",
        contract,
      ]) {
        const result = await request(path, search, { state: "failed" });
        expect(result.status).toBe(200);
        expect(movieIds(result.body), search).toEqual(["fields"]);
      }
      const dateMatch = await request(path, "unmatched".repeat(20), {
        dateSearch: "2026-05-02T10:00:00.000Z",
        state: "failed",
      });
      expect(dateMatch.status).toBe(200);
      expect(movieIds(dateMatch.body)).toEqual(["fields"]);
    }
  });

  it("ranks exact, prefix, and substring collection suggestions for long normalized input", async () => {
    const search = "Àlpha ".repeat(12).trim();
    const names = [search, `${search} Sequel`, `The ${search}`];
    await env.DB.batch(
      names.map((name, index) =>
        env.DB.prepare(
          `INSERT INTO collections
        (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          `collection-${index}`,
          name,
          normalizeTitle(name),
          timestamp,
          timestamp,
        ),
      ),
    );
    const result = await request("/collections/suggestions", search);
    expect(result.status).toBe(200);
    expect(result.body.collections).toEqual(
      names.map((name, index) => ({ id: `collection-${index}`, name })),
    );
    expect(
      (await request("/collections/suggestions", "%_\\\0")).body.collections,
    ).toEqual([]);
    await env.DB.batch(
      Array.from({ length: 9 }, (_, index) => {
        const name = `${search} ${index}`;
        return env.DB.prepare(
          `INSERT INTO collections
        (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          `extra-${index}`,
          name,
          normalizeTitle(name),
          timestamp,
          timestamp,
        );
      }),
    );
    const limited = await request("/collections/suggestions", search);
    expect(limited.body.collections?.map(({ id }) => id)).toEqual([
      "collection-0",
      ...Array.from({ length: 7 }, (_, index) => `extra-${index}`),
    ]);
  });

  it("retains NUL termination for accepted title and search strings", async () => {
    await insertMovie("terminated", "Front\0Hidden");
    for (const path of paths) {
      expect(movieIds((await request(path, "hidden")).body)).toEqual([]);
      expect(movieIds((await request(path, "front\0ignored")).body)).toEqual([
        "terminated",
      ]);
      expect(movieIds((await request(path, "\0ignored")).body)).toEqual([
        "terminated",
      ]);
    }
  });

  it("matches the previous short LIKE expression including NUL and literal escapes", async () => {
    const values = [
      null,
      "",
      "Alpha Éé",
      "100%_\\",
      "Front\0Hidden",
      "Before abc",
      "Before abc after",
      "🧑‍🚀映",
    ];
    const searches = [
      "",
      "aLPHa",
      "É",
      "é",
      "%",
      "_",
      "\\",
      "%_\\",
      "front",
      "hidden",
      "abc\0tail",
      "\0tail",
      "映",
      "🧑‍🚀",
    ];
    for (const value of values) {
      const results = await env.DB.batch<{
        current: number | null;
        previous: number | null;
      }>(
        searches.map((query) => {
          const search = literalSubstringSearch(query);
          return env.DB.prepare(
            `WITH source(value) AS (SELECT ?)
          SELECT LOWER(value) LIKE LOWER(?) ESCAPE char(92) AS previous,
            ${search.condition("value")} AS current
          FROM source`,
          ).bind(
            value,
            `%${query.replace(/[\\%_]/g, "\\$&")}%`,
            ...search.bindings,
          );
        }),
      );
      for (const [index, result] of results.entries()) {
        expect(
          result.results[0].current,
          JSON.stringify({ value, search: searches[index] }),
        ).toEqual(result.results[0].previous);
      }
    }
  });
});
