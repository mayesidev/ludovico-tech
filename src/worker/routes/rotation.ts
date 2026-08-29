import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import {
  getMovie,
  getNowShowing,
  getNowShowingDetail,
  getRandomUnwatchedMovie,
  getRemainingCollectionMovies,
} from "../db";
import { type AppEnv, newId, now } from "../env";
import { mutationActor } from "../middleware";
import { orderInput } from "../schemas";
import { selectQueuedMovie } from "../selection";

export const registerRotationRoutes = (app: Hono<AppEnv>) => {
  app.post("/roll", async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

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
    const remainingCollectionMovies = rolled.collection_id
      ? await getRemainingCollectionMovies(c.env, rolled.collection_id)
      : [];
    const actual = selectQueuedMovie(rolled, remainingCollectionMovies);

    const rollId = newId();
    const [rollInsert] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO rolls
         (id, rolled_movie_id, actual_movie_id, collection_id, created_at, actor_id)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM now_showing
           WHERE id = 1 AND (movie_id IS NULL OR status = 'watched')
         )`,
      ).bind(
        rollId,
        rolled.id,
        actual.id,
        rolled.collection_id,
        timestamp,
        actor.id,
      ),
      c.env.DB.prepare(
        `UPDATE now_showing
         SET rolled_movie_id = ?, movie_id = ?, collection_id = ?,
             status = 'ready', rolled_at = ?, updated_at = ?, updated_by = ?
         WHERE id = 1 AND EXISTS (SELECT 1 FROM rolls WHERE id = ?)`,
      ).bind(
        rolled.id,
        actual.id,
        rolled.collection_id,
        timestamp,
        timestamp,
        actor.id,
        rollId,
      ),
    ]);
    if (!rollInsert.meta.changes) {
      return c.json(
        { error: "Someone else is already choosing the next movie" },
        409,
      );
    }
    return c.json({
      rolledMovie: await getMovie(c.env, rolled.id),
      nowShowing: await getNowShowingDetail(c.env),
    });
  });

  app.post(
    "/collections/:id/order",
    zValidator("json", orderInput, (result, c) => {
      if (!result.success) {
        return c.json(
          { error: "Order must contain valid movie identifiers" },
          400,
        );
      }
    }),
    async (c) => {
      const actor = await mutationActor(c);
      if (!actor) return c.json({ error: "Authentication required" }, 401);

      const collectionId = c.req.param("id");
      const input = c.req.valid("json");
      const members = await c.env.DB.prepare(
        `SELECT collection_movies.movie_id AS id,
         CASE WHEN ratings.movie_id IS NULL THEN 0 ELSE 1 END AS watched
         FROM collection_movies
         LEFT JOIN ratings ON ratings.movie_id = collection_movies.movie_id
         WHERE collection_movies.collection_id = ?`,
      )
        .bind(collectionId)
        .all<{ id: string; watched: number }>();
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

      const watchedIds = new Set(
        members.results
          .filter((movie) => movie.watched)
          .map((movie) => movie.id),
      );
      const firstUnwatchedId = input.movieIds.find(
        (movieId) => !watchedIds.has(movieId),
      );
      const timestamp = now();

      const statements = [
        c.env.DB.prepare(
          "UPDATE collection_movies SET position = position + 1000000 WHERE collection_id = ?",
        ).bind(collectionId),
        ...input.movieIds.map((movieId, index) =>
          c.env.DB.prepare(
            "UPDATE collection_movies SET position = ? WHERE collection_id = ? AND movie_id = ?",
          ).bind(index + 1, collectionId, movieId),
        ),
      ];
      statements.push(
        c.env.DB.prepare(
          `UPDATE collections
           SET order_confirmed = 1, updated_at = ?, updated_by = ?
           WHERE id = ?`,
        ).bind(timestamp, actor.id, collectionId),
      );
      if (firstUnwatchedId) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE now_showing
             SET movie_id = ?, status = 'ready', updated_at = ?, updated_by = ?
             WHERE id = 1 AND collection_id = ? AND status IN ('pending_order', 'ready')`,
          ).bind(firstUnwatchedId, timestamp, actor.id, collectionId),
        );
      }
      await c.env.DB.batch(statements);
      return c.json({ nowShowing: await getNowShowingDetail(c.env) });
    },
  );

  app.post("/next", async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

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
    const next = (
      await getRemainingCollectionMovies(c.env, current.collection_id)
    )[0];
    if (!next) {
      return c.json(
        { error: "This collection is complete", complete: true },
        409,
      );
    }

    const timestamp = now();
    const stateUpdate = await c.env.DB.prepare(
      `UPDATE now_showing
       SET rolled_movie_id = ?, movie_id = ?, status = 'ready',
           updated_at = ?, updated_by = ?
       WHERE id = 1 AND movie_id = ? AND status = 'watched'`,
    )
      .bind(next.id, next.id, timestamp, actor.id, current.movie_id)
      .run();
    if (!stateUpdate.meta.changes) {
      return c.json(
        { error: "Now Showing changed before it could advance" },
        409,
      );
    }
    return c.json({ nowShowing: await getNowShowingDetail(c.env) });
  });
};
