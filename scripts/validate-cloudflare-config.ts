import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type DeploymentTarget,
  validateCloudflareConfigSource,
} from "./validate-cloudflare-config-lib";

const deploymentTargets = new Set<DeploymentTarget>();
if (process.argv.includes("--staging")) deploymentTargets.add("staging");
if (process.argv.includes("--production")) deploymentTargets.add("production");

validateCloudflareConfigSource(
  readFileSync(resolve("wrangler.jsonc"), "utf8"),
  deploymentTargets,
);

console.log("Cloudflare Worker and D1 environment configuration is isolated");
