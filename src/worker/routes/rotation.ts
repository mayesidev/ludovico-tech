import { zValidator } from "@hono/zod-validator";
import { type Hono } from "hono";
import {
  getFranchiseMovies,
  getMovie,
  getNowShowing,
  getRemainingFranchiseMovies,
} from "../db";
import { type AppEnv, newId, now } from "../env";
import { audit, mutationActor } from "../middleware";
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

    const stateUpdate = await c.env.DB.prepare(
      `UPDATE now_showing SET rolled_movie_id = ?, movie_id = ?, franchise_id = ?,
       status = ?, rolled_at = ?, updated_at = ?
     WHERE id = 1 AND (movie_id IS NULL OR status = 'watched')`,
    )
      .bind(
        rolled.id,
        actual.id,
        rolled.franchise_id,
        status,
        timestamp,
        timestamp,
      )
      .run();
    if (!stateUpdate.meta.changes) {
      return c.json(
        { error: "Someone else is already choosing the next movie" },
        409,
      );
    }

    await recordRoll(
      c.env,
      rolled.id,
      actual.id,
      rolled.franchise_id,
      actor.id,
    );
    return c.json({
      rolledMovie: await getMovie(c.env, rolled.id),
      nowShowing: await getNowShowing(c.env),
      needsOrder: status === "pending_order",
      franchiseMovies,
    });
  });

  const recordRoll = async (
    env: AppEnv["Bindings"],
    rolledMovieId: string,
    actualMovieId: string,
    franchiseId: string | null,
    actorId: string,
  ) => {
    await env.DB.prepare(
      "INSERT INTO rolls (id, rolled_movie_id, actual_movie_id, franchise_id, created_at, actor_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(newId(), rolledMovieId, actualMovieId, franchiseId, now(), actorId)
      .run();
  };

  app.post(
    "/franchises/:id/order",
    zValidator("json", orderInput),
    async (c) => {
      const actor = await mutationActor(c);
      if (!actor) return c.json({ error: "Authentication required" }, 401);

      const franchiseId = c.req.param("id");
      const input = c.req.valid("json");
      const members = await c.env.DB.prepare(
        "SELECT movie_id AS id FROM franchise_movies WHERE franchise_id = ?",
      )
        .bind(franchiseId)
        .all<{ id: string }>();
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
        ).bind(now(), franchiseId),
      );
      await c.env.DB.batch(statements);

      const current = await getNowShowing(c.env);
      if (
        current?.franchise_id === franchiseId &&
        current.status === "pending_order"
      ) {
        const first = (
          await getRemainingFranchiseMovies(c.env, franchiseId)
        )[0];
        if (first) {
          await c.env.DB.prepare(
            "UPDATE now_showing SET movie_id = ?, status = 'ready', updated_at = ? WHERE id = 1",
          )
            .bind(first.id, now())
            .run();
        }
      }
      await audit(c.env, "franchise", franchiseId, "order_updated", actor.id, {
        movieIds: input.movieIds,
      });
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

    await c.env.DB.prepare(
      "UPDATE now_showing SET rolled_movie_id = ?, movie_id = ?, status = 'ready', updated_at = ? WHERE id = 1",
    )
      .bind(next.id, next.id, now())
      .run();
    await audit(c.env, "now_showing", "1", "advanced", actor.id, {
      movieId: next.id,
    });
    return c.json({ nowShowing: await getNowShowing(c.env) });
  });
};
