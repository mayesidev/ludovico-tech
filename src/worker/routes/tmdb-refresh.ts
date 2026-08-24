import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import { now, type AppEnv } from "../env";
import { auditStatement, mutationActor } from "../middleware";
import {
  claimTmdbRefresh,
  executeTmdbRefreshClaim,
  getTmdbRefreshStatus,
} from "../tmdb-refresh";

const scheduleInput = z.object({ enabled: z.boolean() }).strict();

export const registerTmdbRefreshRoutes = (app: Hono<AppEnv>) => {
  app.get("/tmdb-refresh", async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);
    return c.json(await getTmdbRefreshStatus(c.env));
  });

  app.patch(
    "/tmdb-refresh/schedule",
    zValidator("json", scheduleInput),
    async (c) => {
      const actor = await mutationActor(c);
      if (!actor) return c.json({ error: "Authentication required" }, 401);

      const { enabled } = c.req.valid("json");
      const timestamp = now();
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE tmdb_refresh_schedule
           SET enabled = ?, updated_at = ?
           WHERE id = 1`,
        ).bind(enabled ? 1 : 0, timestamp),
        auditStatement(
          c.env,
          "tmdb_refresh_schedule",
          "1",
          enabled ? "schedule_resumed" : "schedule_paused",
          actor.id,
          { enabled },
        ),
      ]);
      return c.json({ enabled });
    },
  );

  app.post("/tmdb-refresh/run", async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);

    const claim = await claimTmdbRefresh(c.env, true);
    if (!claim) {
      return c.json(
        { error: "TMDB refresh is disabled or already running" },
        409,
      );
    }
    await auditStatement(
      c.env,
      "tmdb_refresh_schedule",
      "1",
      "run_requested",
      actor.id,
    ).run();
    c.executionCtx.waitUntil(
      executeTmdbRefreshClaim(c.env, claim).catch(() => {
        console.error("TMDB manual refresh failed");
      }),
    );
    return c.json({ started: true }, 202);
  });
};
