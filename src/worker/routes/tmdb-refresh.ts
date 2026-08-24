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

const scheduleInput = z
  .object({
    batchSize: z.number().int().min(1).max(50).optional(),
    enabled: z.boolean().optional(),
    intervalMinutes: z
      .number()
      .int()
      .min(15)
      .max(10080)
      .multipleOf(15)
      .optional(),
  })
  .strict()
  .refine(
    ({ batchSize, enabled, intervalMinutes }) =>
      batchSize !== undefined ||
      enabled !== undefined ||
      intervalMinutes !== undefined,
    { message: "Provide at least one schedule setting" },
  );

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

      const input = c.req.valid("json");
      const timestamp = now();
      const nextRunAt =
        input.intervalMinutes === undefined
          ? null
          : new Date(
              new Date(timestamp).getTime() + input.intervalMinutes * 60 * 1000,
            ).toISOString();
      const action =
        input.batchSize !== undefined || input.intervalMinutes !== undefined
          ? "schedule_updated"
          : input.enabled
            ? "schedule_resumed"
            : "schedule_paused";
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE tmdb_refresh_schedule
           SET enabled = COALESCE(?, enabled),
               interval_minutes = COALESCE(?, interval_minutes),
               batch_size = COALESCE(?, batch_size),
               next_run_at = COALESCE(?, next_run_at),
               updated_at = ?
           WHERE id = 1`,
        ).bind(
          input.enabled === undefined ? null : input.enabled ? 1 : 0,
          input.intervalMinutes ?? null,
          input.batchSize ?? null,
          nextRunAt,
          timestamp,
        ),
        auditStatement(
          c.env,
          "tmdb_refresh_schedule",
          "1",
          action,
          actor.id,
          input,
        ),
      ]);
      return c.json({ updated: true as const });
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
