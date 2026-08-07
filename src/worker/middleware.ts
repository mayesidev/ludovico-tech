import type { Context } from "hono";
import { getActor, newId, now, type AppEnv } from "./env";

export const mutationActor = async (c: Context<AppEnv>) => {
  const actor = await getActor(c.env, c.req.raw);
  return actor;
};

export const audit = async (
  env: AppEnv["Bindings"],
  entityType: string,
  entityId: string,
  action: string,
  actorId: string | null,
  details?: Record<string, unknown>,
) => {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, created_at, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      entityType,
      entityId,
      action,
      actorId,
      now(),
      details ? JSON.stringify(details) : null,
    )
    .run();
};
