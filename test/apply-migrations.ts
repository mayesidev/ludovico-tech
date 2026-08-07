import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import "./deny-network";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
