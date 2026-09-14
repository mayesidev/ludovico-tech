import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import {
  getMovie,
  getNowShowing,
  getNowShowingDetail,
  getRandomUnwatchedMovie,
  hasRemainingCollectionMovie,
} from "../db";
import { type AppEnv, now } from "../env";
import { mutationUser } from "../middleware";
import {
  COLLECTION_LIMIT_MESSAGE,
  MAX_COLLECTION_TITLES,
} from "../../shared/collection-limits";
import { orderInput } from "../schemas";

// Keep collection ordering identical to the catalog and collection detail views.
const firstUnwatchedCollectionMovie = `
  SELECT movies.id
  FROM collection_memberships
  JOIN movies ON movies.id = collection_memberships.movie_id
  JOIN collections ON collections.id = collection_memberships.collection_id
  WHERE collection_memberships.collection_id = ?
    AND NOT EXISTS (SELECT 1 FROM ratings WHERE ratings.movie_id = movies.id)
  ORDER BY
    CASE WHEN collections.order_confirmed = 1 THEN collection_memberships.position END ASC,
    CASE WHEN collections.order_confirmed = 0 THEN movies.added_at END ASC,
    movies.added_at ASC,
    movies.id ASC
  LIMIT 1
`;

// Revalidate the submitted member set inside each atomic batch statement.
// 1,000 IDs of at most 200 UTF-16 units encode to at most 1,203,001 bytes,
// below D1's 2,000,000-byte value limit even with JSON escaping.
const validCollectionOrder = `
  WITH submitted_order AS MATERIALIZED (
    SELECT value AS movie_id, key + 1 AS position FROM json_each(?)
  ), valid_order AS MATERIALIZED (
    SELECT 1
    WHERE (SELECT COUNT(*) FROM collection_memberships WHERE collection_id = ?)
      = (SELECT COUNT(*) FROM submitted_order)
      AND NOT EXISTS (
        SELECT movie_id FROM collection_memberships WHERE collection_id = ?
        EXCEPT SELECT movie_id FROM submitted_order
      )
  )
`;

export const registerRotationRoutes = (app: Hono<AppEnv>) => {
  app.post("/roll", async (c) => {
    const user = await mutationUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const current = await getNowShowing(c.env);
    if (current?.movie_id && current.rating_score === null) {
      return c.json(
        { error: "Rate the current movie before rolling again" },
        409,
      );
    }

    const rolled = await getRandomUnwatchedMovie(c.env);
    if (!rolled) {
      return c.json({ error: "There are no unwatched movies left" }, 409);
    }

    const timestamp = now();
    const stateUpdate = await c.env.DB.prepare(
      `WITH eligible_roll AS (
         SELECT movies.id, collection_memberships.collection_id
         FROM movies
         LEFT JOIN collection_memberships ON collection_memberships.movie_id = movies.id
         WHERE movies.id = ? AND collection_memberships.collection_id IS ?
           AND NOT EXISTS (SELECT 1 FROM ratings WHERE ratings.movie_id = movies.id)
       ), candidate AS (
         SELECT CASE WHEN collection_id IS NULL THEN id
           ELSE (${firstUnwatchedCollectionMovie}) END AS id
         FROM eligible_roll
       )
       UPDATE now_showing
       SET movie_id = (SELECT id FROM candidate), rolled_at = ?, rolled_by = ?
       WHERE id = 1 AND (SELECT id FROM candidate) IS NOT NULL AND (
         movie_id IS NULL OR EXISTS (
           SELECT 1 FROM ratings WHERE ratings.movie_id = now_showing.movie_id
         )
       )`,
    )
      .bind(
        rolled.id,
        rolled.collection_id,
        rolled.collection_id,
        timestamp,
        user.id,
      )
      .run();
    if (!stateUpdate.meta.changes) {
      return c.json(
        { error: "Someone else is already choosing the next movie" },
        409,
      );
    }
    return c.json({
      rolledMovie: await getMovie(c.env, rolled.id),
      nowShowing: await getNowShowingDetail(c.env, true),
    });
  });

  app.post(
    "/collections/:id/order",
    zValidator("json", orderInput, (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: result.error.issues.some(
              (issue) =>
                issue.code === "too_big" &&
                issue.path.length === 1 &&
                issue.path[0] === "movieIds",
            )
              ? COLLECTION_LIMIT_MESSAGE
              : "Order must contain valid movie identifiers",
          },
          400,
        );
      }
    }),
    async (c) => {
      const user = await mutationUser(c);
      if (!user) return c.json({ error: "Authentication required" }, 401);

      const collectionId = c.req.param("id");
      const input = c.req.valid("json");
      const members = await c.env.DB.prepare(
        `SELECT movie_id AS id FROM collection_memberships WHERE collection_id = ? LIMIT ?`,
      )
        .bind(collectionId, MAX_COLLECTION_TITLES + 1)
        .all<{ id: string }>();
      if (members.results.length > MAX_COLLECTION_TITLES) {
        return c.json({ error: COLLECTION_LIMIT_MESSAGE }, 400);
      }
      const memberIds = new Set(members.results.map((movie) => movie.id));
      if (
        input.movieIds.length !== memberIds.size ||
        new Set(input.movieIds).size !== memberIds.size ||
        input.movieIds.some((id) => !memberIds.has(id))
      ) {
        return c.json(
          {
            error:
              "Order must include every movie in the collection exactly once",
          },
          400,
        );
      }

      const timestamp = now();
      const order = JSON.stringify(input.movieIds);
      const statements = [
        c.env.DB.prepare(
          `${validCollectionOrder}
           UPDATE collection_memberships
           SET position = position + (
             SELECT MAX(position) FROM collection_memberships WHERE collection_id = ?
           )
           WHERE collection_id = ? AND EXISTS (SELECT 1 FROM valid_order)`,
        ).bind(order, collectionId, collectionId, collectionId, collectionId),
        c.env.DB.prepare(
          `${validCollectionOrder}
           UPDATE collection_memberships SET position = submitted_order.position
           FROM submitted_order
           WHERE collection_id = ?
             AND collection_memberships.movie_id = submitted_order.movie_id
             AND EXISTS (SELECT 1 FROM valid_order)`,
        ).bind(order, collectionId, collectionId, collectionId),
        c.env.DB.prepare(
          `${validCollectionOrder}
           UPDATE collections
           SET order_confirmed = 1, updated_at = ?, updated_by = ?
           WHERE id = ? AND EXISTS (SELECT 1 FROM valid_order)`,
        ).bind(
          order,
          collectionId,
          collectionId,
          timestamp,
          user.id,
          collectionId,
        ),
        c.env.DB.prepare(
          `${validCollectionOrder}, candidate AS (${firstUnwatchedCollectionMovie})
           UPDATE now_showing
           SET movie_id = (SELECT id FROM candidate), rolled_at = ?, rolled_by = ?
           WHERE id = 1
             AND EXISTS (SELECT 1 FROM valid_order)
             AND (SELECT id FROM candidate) IS NOT NULL
             AND movie_id IN (
               SELECT movie_id FROM collection_memberships WHERE collection_id = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM ratings WHERE ratings.movie_id = now_showing.movie_id
             )`,
        ).bind(
          order,
          collectionId,
          collectionId,
          collectionId,
          timestamp,
          user.id,
          collectionId,
        ),
      ];
      const results = await c.env.DB.batch(statements);
      if (!results[2].meta.changes) {
        return c.json(
          { error: "The collection changed before its order could be saved" },
          409,
        );
      }
      return c.json({ nowShowing: await getNowShowingDetail(c.env, true) });
    },
  );

  app.post("/next", async (c) => {
    const user = await mutationUser(c);
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const current = await getNowShowing(c.env);
    if (
      !current?.movie_id ||
      current.rating_score === null ||
      !current.collection_id
    ) {
      return c.json(
        { error: "No watched collection movie is ready to advance" },
        409,
      );
    }
    if (!(await hasRemainingCollectionMovie(c.env, current.collection_id))) {
      return c.json(
        { error: "This collection is complete", complete: true },
        409,
      );
    }

    const timestamp = now();
    const stateUpdate = await c.env.DB.prepare(
      `WITH candidate AS (${firstUnwatchedCollectionMovie})
       UPDATE now_showing
       SET movie_id = (SELECT id FROM candidate), rolled_at = ?, rolled_by = ?
       WHERE id = 1 AND movie_id = ?
         AND (SELECT id FROM candidate) IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM collection_memberships
           WHERE movie_id = now_showing.movie_id AND collection_id = ?
         )
         AND EXISTS (
           SELECT 1 FROM ratings WHERE ratings.movie_id = now_showing.movie_id
         )`,
    )
      .bind(
        current.collection_id,
        timestamp,
        user.id,
        current.movie_id,
        current.collection_id,
      )
      .run();
    if (!stateUpdate.meta.changes) {
      return c.json(
        { error: "Now Showing changed before it could advance" },
        409,
      );
    }
    return c.json({ nowShowing: await getNowShowingDetail(c.env, true) });
  });
};
