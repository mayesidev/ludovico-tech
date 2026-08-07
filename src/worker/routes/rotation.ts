import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import {
  getFranchiseMovies,
  getMovie,
  getNowShowing,
  getRemainingFranchiseMovies,
} from "../db";
import { type AppEnv, newId, now } from "../env";
import { auditStatement, mutationActor } from "../middleware";
import { orderInput } from "../schemas";

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

    const rolled = await c.env.DB.prepare(
      `SELECT movies.id, movies.title, franchise_movies.franchise_id
       FROM movies
       LEFT JOIN franchise_movies ON franchise_movies.movie_id = movies.id
       LEFT JOIN ratings ON ratings.movie_id = movies.id
       WHERE ratings.id IS NULL ORDER BY RANDOM() LIMIT 1`,
    ).first<{ id: string; title: string; franchise_id: string | null }>();
    if (!rolled) {
      return c.json({ error: "There are no unwatched movies left" }, 409);
    }

    const timestamp = now();
    const franchiseMovies = rolled.franchise_id
      ? await getFranchiseMovies(c.env, rolled.franchise_id)
      : [];
    const franchise = rolled.franchise_id
      ? await c.env.DB.prepare(
          "SELECT order_confirmed FROM franchises WHERE id = ?",
        )
          .bind(rolled.franchise_id)
          .first<{ order_confirmed: number }>()
      : null;
    const remainingFranchiseMovies = rolled.franchise_id
      ? await getRemainingFranchiseMovies(c.env, rolled.franchise_id)
      : [];
    const actual =
      rolled.franchise_id && franchise?.order_confirmed
        ? (remainingFranchiseMovies[0] ?? rolled)
        : rolled;
    const status =
      rolled.franchise_id && !franchise?.order_confirmed
        ? "pending_order"
        : "ready";

    const rollId = newId();
    const [rollInsert] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO rolls
         (id, rolled_movie_id, actual_movie_id, franchise_id, created_at, actor_id)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM now_showing
           WHERE id = 1 AND (movie_id IS NULL OR status = 'watched')
         )`,
      ).bind(
        rollId,
        rolled.id,
        actual.id,
        rolled.franchise_id,
        timestamp,
        actor.id,
      ),
      c.env.DB.prepare(
        `UPDATE now_showing SET rolled_movie_id = ?, movie_id = ?, franchise_id = ?,
         status = ?, rolled_at = ?, updated_at = ?
         WHERE id = 1 AND EXISTS (SELECT 1 FROM rolls WHERE id = ?)`,
      ).bind(
        rolled.id,
        actual.id,
        rolled.franchise_id,
        status,
        timestamp,
        timestamp,
        rollId,
      ),
      c.env.DB.prepare(
        `INSERT INTO audit_log
         (id, entity_type, entity_id, action, actor_id, created_at, details_json)
         SELECT ?, 'now_showing', '1', 'rolled', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM rolls WHERE id = ?)`,
      ).bind(
        newId(),
        actor.id,
        timestamp,
        JSON.stringify({
          rollId,
          rolledMovieId: rolled.id,
          actualMovieId: actual.id,
        }),
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
      nowShowing: await getNowShowing(c.env),
      needsOrder: status === "pending_order",
      franchiseMovies,
    });
  });

  app.post(
    "/franchises/:id/order",
    zValidator("json", orderInput),
    async (c) => {
      const actor = await mutationActor(c);
      if (!actor) return c.json({ error: "Authentication required" }, 401);

      const franchiseId = c.req.param("id");
      const input = c.req.valid("json");
      const members = await c.env.DB.prepare(
        `SELECT franchise_movies.movie_id AS id,
         CASE WHEN ratings.id IS NULL THEN 0 ELSE 1 END AS watched
         FROM franchise_movies
         LEFT JOIN ratings ON ratings.movie_id = franchise_movies.movie_id
         WHERE franchise_movies.franchise_id = ?`,
      )
        .bind(franchiseId)
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
              "Order must include every movie in the franchise exactly once",
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
          "UPDATE franchise_movies SET position = position + 1000000 WHERE franchise_id = ?",
        ).bind(franchiseId),
        ...input.movieIds.map((movieId, index) =>
          c.env.DB.prepare(
            "UPDATE franchise_movies SET position = ? WHERE franchise_id = ? AND movie_id = ?",
          ).bind(index + 1, franchiseId, movieId),
        ),
      ];
      statements.push(
        c.env.DB.prepare(
          "UPDATE franchises SET order_confirmed = 1, updated_at = ? WHERE id = ?",
        ).bind(timestamp, franchiseId),
      );
      if (firstUnwatchedId) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE now_showing SET movie_id = ?, status = 'ready', updated_at = ?
             WHERE id = 1 AND franchise_id = ? AND status = 'pending_order'`,
          ).bind(firstUnwatchedId, timestamp, franchiseId),
        );
      }
      statements.push(
        auditStatement(
          c.env,
          "franchise",
          franchiseId,
          "order_updated",
          actor.id,
          { movieIds: input.movieIds },
        ),
      );
      await c.env.DB.batch(statements);
      return c.json({ nowShowing: await getNowShowing(c.env) });
    },
  );

  app.post("/next", async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const current = await getNowShowing(c.env);
    if (
      !current?.movie_id ||
      current.rating_score === null ||
      !current.franchise_id
    ) {
      return c.json(
        { error: "No watched franchise movie is ready to advance" },
        409,
      );
    }
    const next = (
      await getRemainingFranchiseMovies(c.env, current.franchise_id)
    )[0];
    if (!next) {
      return c.json(
        { error: "This franchise is complete", complete: true },
        409,
      );
    }

    const timestamp = now();
    const [stateUpdate] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE now_showing SET rolled_movie_id = ?, movie_id = ?, status = 'ready', updated_at = ?
         WHERE id = 1 AND movie_id = ? AND status = 'watched'`,
      ).bind(next.id, next.id, timestamp, current.movie_id),
      c.env.DB.prepare(
        `INSERT INTO audit_log
         (id, entity_type, entity_id, action, actor_id, created_at, details_json)
         SELECT ?, 'now_showing', '1', 'advanced', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM now_showing
           WHERE id = 1 AND movie_id = ? AND status = 'ready' AND updated_at = ?
         )`,
      ).bind(
        newId(),
        actor.id,
        timestamp,
        JSON.stringify({ movieId: next.id }),
        next.id,
        timestamp,
      ),
    ]);
    if (!stateUpdate.meta.changes) {
      return c.json(
        { error: "Now Showing changed before it could advance" },
        409,
      );
    }
    return c.json({ nowShowing: await getNowShowing(c.env) });
  });
};
