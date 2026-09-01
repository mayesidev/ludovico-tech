import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEPLOYMENT_DATABASE_ID_SENTINELS,
  type DeploymentTarget,
  validateCloudflareConfigSource,
} from "./validate-cloudflare-config-lib";

const deploymentTargets = new Set<DeploymentTarget>();
for (const argument of process.argv.slice(2)) {
  const target = argument.startsWith("--") ? argument.slice(2) : "";
  if (!(target in DEPLOYMENT_DATABASE_ID_SENTINELS)) {
    throw new Error(`Unknown deployment target ${argument}`);
  }
  deploymentTargets.add(target as DeploymentTarget);
}

validateCloudflareConfigSource(
  readFileSync(resolve("wrangler.jsonc"), "utf8"),
  deploymentTargets,
);

console.log("Cloudflare Worker and D1 environment configuration is isolated");
