import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";

const app = createApp();
const request = async (path: string, body?: unknown, method = "POST") => {
  const response = await app.fetch(
    new Request(`https://ludovico-tech.test/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return {
    response,
    body: (await response.json()) as {
      movie: { id: string; collection_id: string; collection_name: string };
      collections: Array<{ id: string; name: string }>;
    },
  };
};
const add = (title: string, collectionName: string) =>
  request("/movies", { title, collectionName });

describe("Unicode collection identity", () => {
  it.each([
    ["東宝", "松竹"],
    ["Москва", "Киев"],
    ["क", "कि"],
    ["か", "が"],
    ["!!!", "???"],
    ["☀️", "☂️"],
    ["🎬", "🎭"],
  ])(
    "keeps %s and %s distinct when adding and moving movies",
    async (firstName, secondName) => {
      const first = await add("First movie", firstName);
      const second = await add("Second movie", secondName);
      expect(first.response.status).toBe(201);
      expect(second.response.status).toBe(201);
      expect(first.body.movie.collection_id).not.toBe(
        second.body.movie.collection_id,
      );
      const moved = await request(
        `/movies/${first.body.movie.id}`,
        { collectionName: secondName },
        "PATCH",
      );
      expect(moved.response.status).toBe(200);
      expect(moved.body.movie.collection_id).toBe(
        second.body.movie.collection_id,
      );
      expect(
        await env.DB.prepare(
          "SELECT movie_id FROM collection_memberships WHERE collection_id = ? ORDER BY position",
        )
          .bind(second.body.movie.collection_id)
          .all<{ movie_id: string }>(),
      ).toMatchObject({
        results: [
          { movie_id: second.body.movie.id },
          { movie_id: first.body.movie.id },
        ],
      });
    },
  );

  it("reuses accent and case aliases for add/edit without changing the retained name", async () => {
    const first = await add("First movie", "Café");
    const second = await add("Second movie", "CAFE");
    expect(second.body.movie.collection_id).toBe(
      first.body.movie.collection_id,
    );
    const edited = await request(
      `/movies/${first.body.movie.id}`,
      { collectionName: "cafe\u0301" },
      "PATCH",
    );
    expect(edited.response.status).toBe(200);
    expect(edited.body.movie.collection_name).toBe("Café");
    expect(edited.body.movie.collection_id).toBe(
      first.body.movie.collection_id,
    );
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM collections").first(),
    ).toEqual({ total: 1 });
  });

  it.each(["東宝", "МОСКВА", "cafe", "☀️", "%", "_", "\\"])(
    "suggests literal Unicode and symbol names for %s",
    async (search) => {
      for (const [index, name] of [
        "東宝",
        "Москва",
        "Café",
        "☀️",
        "☂️",
        "%",
        "_",
        "\\",
      ].entries()) {
        await add(`Movie ${index}`, name);
      }
      const result = await request(
        `/collections/suggestions?search=${encodeURIComponent(search)}`,
        undefined,
        "GET",
      );
      expect(result.response.status).toBe(200);
      expect(result.body.collections).toHaveLength(1);
      expect(result.body.collections[0].name).toBe(
        search === "МОСКВА" ? "Москва" : search === "cafe" ? "Café" : search,
      );
    },
  );
});
