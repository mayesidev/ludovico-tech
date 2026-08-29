import type { Context } from "hono";
import { getActor, type AppEnv } from "./env";

export const mutationActor = async (c: Context<AppEnv>) => {
  const actor = await getActor(c.env, c.req.raw);
  return actor;
};
