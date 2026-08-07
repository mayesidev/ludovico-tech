import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

type D1Binding = {
  binding?: string;
  database_id?: string;
  database_name?: string;
  preview_database_id?: string;
};

type WorkerEnvironment = {
  d1_databases?: D1Binding[];
  name?: string;
  secrets?: { required?: string[] };
  vars?: Record<string, string>;
  workers_dev?: boolean;
};

type WranglerConfig = {
  d1_databases?: D1Binding[];
  env?: Record<string, WorkerEnvironment>;
  name?: string;
  workers_dev?: boolean;
};

const DEVELOPMENT_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
const PRODUCTION_DATABASE_ID_SENTINEL = "11111111-1111-1111-1111-111111111111";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseErrors: ParseError[] = [];
const config = parse(
  readFileSync(resolve("wrangler.jsonc"), "utf8"),
  parseErrors,
  { allowTrailingComma: true },
) as WranglerConfig;

if (parseErrors.length) {
  const codes = parseErrors.map((error) => printParseErrorCode(error.error));
  throw new Error(`wrangler.jsonc is invalid JSONC: ${codes.join(", ")}`);
}

const requireValue = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new Error(message);
  return value;
};

const validateEnvironment = (
  key: "development" | "production",
  expectedAuthMode: "development" | "google",
) => {
  const environment = requireValue(
    config.env?.[key],
    `Missing ${key} Worker environment`,
  );
  if (environment.name !== `ludovico-tech-${key}`) {
    throw new Error(`${key} Worker name must be ludovico-tech-${key}`);
  }
  if (
    environment.vars?.APP_ENV !== key ||
    environment.vars?.AUTH_MODE !== expectedAuthMode
  ) {
    throw new Error(`${key} runtime variables are not fail-closed`);
  }
  const databases = environment.d1_databases ?? [];
  if (databases.length !== 1 || databases[0]?.binding !== "DB") {
    throw new Error(`${key} must define exactly one DB binding`);
  }
  const database = databases[0];
  if (database.database_name !== `ludovico-tech-${key}`) {
    throw new Error(`${key} D1 name must be ludovico-tech-${key}`);
  }
  if (!database.database_id || !UUID_PATTERN.test(database.database_id)) {
    throw new Error(`${key} D1 ID must be a UUID`);
  }
  return { environment, database };
};

if (config.name !== "ludovico-tech") {
  throw new Error("Top-level Worker name must be ludovico-tech");
}
if (config.workers_dev !== false) {
  throw new Error("The unqualified Worker environment must not be deployable");
}
if (config.d1_databases?.length) {
  throw new Error(
    "D1 bindings must be declared only inside named environments",
  );
}

const development = validateEnvironment("development", "development");
const production = validateEnvironment("production", "google");

if (development.environment.workers_dev !== false) {
  throw new Error("The development Worker must not be remotely deployable");
}
if (development.database.database_id !== DEVELOPMENT_DATABASE_ID) {
  throw new Error("Development must use the inert local-only D1 ID");
}
if (
  development.database.preview_database_id !== "ludovico-tech-development-local"
) {
  throw new Error("Development must use its own local D1 preview identity");
}
if (development.database.database_id === production.database.database_id) {
  throw new Error("Development and production must never share a D1 ID");
}

const requiredDevelopmentSecrets = ["TMDB_READ_ACCESS_TOKEN"];
const requiredProductionSecrets = [
  "ALLOWED_EMAILS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "TMDB_READ_ACCESS_TOKEN",
];
const sorted = (values: string[] | undefined) => [...(values ?? [])].sort();
if (
  JSON.stringify(sorted(development.environment.secrets?.required)) !==
  JSON.stringify(sorted(requiredDevelopmentSecrets))
) {
  throw new Error("Development secret allowlist is incorrect");
}
if (
  JSON.stringify(sorted(production.environment.secrets?.required)) !==
  JSON.stringify(sorted(requiredProductionSecrets))
) {
  throw new Error("Production secret allowlist is incomplete");
}

for (const [key, environment] of Object.entries(config.env ?? {})) {
  const secretLikeVars = Object.keys(environment.vars ?? {}).filter((name) =>
    /(TOKEN|SECRET|PASSWORD|ALLOWED_EMAILS|CLIENT_ID)/i.test(name),
  );
  if (secretLikeVars.length) {
    throw new Error(`${key} contains secret-like values in public vars`);
  }
}

if (
  process.argv.includes("--production") &&
  production.database.database_id === PRODUCTION_DATABASE_ID_SENTINEL
) {
  throw new Error(
    "Production D1 is not provisioned; replace the sentinel with the dedicated database ID",
  );
}

console.log("Cloudflare Worker and D1 environment configuration is isolated");
