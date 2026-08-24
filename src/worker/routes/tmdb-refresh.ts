import type { Hono } from "hono";
import type { AppEnv } from "../env";
import { auditStatement, mutationActor } from "../middleware";
import {
  claimTmdbRefresh,
  executeTmdbRefreshClaim,
  getTmdbRefreshStatus,
} from "../tmdb-refresh";

export const registerTmdbRefreshRoutes = (app: Hono<AppEnv>) => {
  app.get("/tmdb-refresh", async (c) => {
    const actor = await mutationActor(c);
    if (!actor) return c.json({ error: "Authentication required" }, 401);
    return c.json(await getTmdbRefreshStatus(c.env));
  });

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
