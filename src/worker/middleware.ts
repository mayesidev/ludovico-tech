import type { Context } from "hono";
import { getAuthenticatedUser, type AppEnv } from "./env";

export const mutationUser = async (c: Context<AppEnv>) => {
  const user = await getAuthenticatedUser(c.env, c.req.raw);
  return user;
};
