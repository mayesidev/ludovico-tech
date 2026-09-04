import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const releaseTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const gitShaPattern = /^[0-9a-f]{40}$/;
const deploymentTargets = {
  "production-family-bonding": {
    origin: "https://familybonding.ludovicotech.com",
    runtimeEnvironment: "production",
  },
  production: {
    origin: "https://ludovicotech.com",
    runtimeEnvironment: "production",
  },
  staging: {
    origin: "https://staging.ludovicotech.com",
    runtimeEnvironment: "staging",
  },
} as const;
const deploymentSmokePath =
  "/api/library?direction=asc&page=1&pageSize=25&search=&sort=title&status=all";

type DeploymentTarget = keyof typeof deploymentTargets;

const isDeploymentTarget = (value: string): value is DeploymentTarget =>
  value in deploymentTargets;

const deploymentTarget = (value: string) => {
  if (!isDeploymentTarget(value)) {
    throw new Error("Deployment target is invalid");
  }
  return deploymentTargets[value];
};

export const isReleaseTag = (value: string) => releaseTagPattern.test(value);

const deploymentBaseUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Deployment base URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Deployment base URL must be an HTTPS origin");
  }
  return url;
};

export const validateDeploymentTarget = (
  baseUrl: string,
  releaseTag: string,
  gitSha: string,
  expectedTarget: string,
) => {
  const target = deploymentTarget(expectedTarget);
  const url = deploymentBaseUrl(baseUrl);
  if (!isReleaseTag(releaseTag)) throw new Error("Release tag is invalid");
  if (!gitShaPattern.test(gitSha)) throw new Error("Commit SHA is invalid");
  if (url.origin !== target.origin) {
    throw new Error("Deployment origin does not match the target");
  }
  return url;
};

const appliedMigrationNames = (value: unknown) => {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("D1 migration response is invalid");
  }
  const result = value[0];
  if (
    !result ||
    typeof result !== "object" ||
    (result as Record<string, unknown>).success !== true ||
    !Array.isArray((result as Record<string, unknown>).results)
  ) {
    throw new Error("D1 migration query failed");
  }
  const names = (result as { results: unknown[] }).results.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof (row as Record<string, unknown>).name !== "string"
    ) {
      throw new Error("D1 migration response contains an invalid row");
    }
    return String((row as Record<string, unknown>).name);
  });
  if (new Set(names).size !== names.length) {
    throw new Error("D1 migration response contains duplicate names");
  }
  return names.sort();
};

export const assertReleaseMigrationsApplied = (
  expectedNames: string[],
  response: unknown,
) => {
  if (
    !expectedNames.length ||
    expectedNames.some((name) => !/^\d+.*\.sql$/.test(name)) ||
    new Set(expectedNames).size !== expectedNames.length
  ) {
    throw new Error("Release migration set is invalid");
  }
  const expected = [...expectedNames].sort();
  const applied = appliedMigrationNames(response);
  const pending = expected.filter((name) => !applied.includes(name));
  if (pending.length) {
    throw new Error(
      `Target database has ${pending.length} pending release migration${pending.length === 1 ? "" : "s"}`,
    );
  }
  const unexpected = applied.filter((name) => !expected.includes(name));
  if (unexpected.length) {
    throw new Error(
      `Target database has ${unexpected.length} migration${unexpected.length === 1 ? "" : "s"} not present in release`,
    );
  }
};

export const assertTmdbRefreshIdle = (response: unknown) => {
  if (!Array.isArray(response) || response.length !== 1) {
    throw new Error("TMDB refresh schedule response is invalid");
  }
  const result = response[0];
  if (
    !result ||
    typeof result !== "object" ||
    (result as Record<string, unknown>).success !== true ||
    !Array.isArray((result as Record<string, unknown>).results) ||
    (result as { results: unknown[] }).results.length !== 1
  ) {
    throw new Error("TMDB refresh schedule query failed");
  }
  const row = (result as { results: unknown[] }).results[0];
  if (!row || typeof row !== "object") {
    throw new Error("TMDB refresh schedule row is invalid");
  }
  const schedule = row as Record<string, unknown>;
  if (schedule.lease_expires_at !== null) {
    throw new Error("TMDB refresh must have no active lease");
  }
};

export const assertTmdbRefreshDisabled = (response: unknown) => {
  assertTmdbRefreshIdle(response);
  const row = (
    response as Array<{ results: Array<Record<string, unknown>> }>
  )[0].results[0];
  if (row?.enabled !== 0) {
    throw new Error("TMDB refresh schedule must be disabled");
  }
};

const familyBondingBootstrapState = (response: unknown) => {
  if (!Array.isArray(response) || response.length !== 1) {
    throw new Error("Family Bonding bootstrap response is invalid");
  }
  const result = response[0];
  if (
    !result ||
    typeof result !== "object" ||
    (result as Record<string, unknown>).success !== true ||
    !Array.isArray((result as Record<string, unknown>).results) ||
    (result as { results: unknown[] }).results.length !== 1
  ) {
    throw new Error("Family Bonding bootstrap query failed");
  }
  const row = (result as { results: unknown[] }).results[0];
  if (!row || typeof row !== "object") {
    throw new Error("Family Bonding bootstrap row is invalid");
  }
  const seed = row as Record<string, unknown>;
  return seed;
};

export const assertFamilyBondingEmpty = (response: unknown) => {
  const seed = familyBondingBootstrapState(response);
  if (
    seed.has_movies !== 0 ||
    seed.has_collections !== 0 ||
    seed.has_ratings !== 0 ||
    seed.has_tmdb_links !== 0 ||
    seed.now_showing_movie_id !== null
  ) {
    throw new Error("Family Bonding target is not empty");
  }
};

export const assertFamilyBondingPopulated = (response: unknown) => {
  const state = familyBondingBootstrapState(response);
  if (state.has_movies !== 1) {
    throw new Error("Family Bonding catalog is not populated");
  }
};

export const assertFamilyBondingInitialCatalog = (response: unknown) => {
  const state = familyBondingBootstrapState(response);
  if (state.has_movies !== 1 || state.now_showing_movie_id !== null) {
    throw new Error("Family Bonding initial catalog is not ready");
  }
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Sleep = (milliseconds: number) => Promise<void>;

const deploymentVerificationAttempts = 13;
const deploymentVerificationDelayMs = 5_000;

const json = async (response: Response) => {
  if (!response.ok) throw new Error("Deployment endpoint is not ready");
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("Deployment endpoint returned invalid JSON");
  }
};

const responseJson = async (response: Response) => {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("Deployment endpoint returned invalid JSON");
  }
};

const record = (value: unknown, message: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
};

export const verifyDeployment = async (
  fetcher: Fetcher,
  sleep: Sleep,
  baseUrl: string,
  releaseTag: string,
  gitSha: string,
  expectedTarget: string,
  attempts = deploymentVerificationAttempts,
) => {
  const origin = validateDeploymentTarget(
    baseUrl,
    releaseTag,
    gitSha,
    expectedTarget,
  );
  const expectedRuntimeEnvironment =
    deploymentTarget(expectedTarget).runtimeEnvironment;
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > deploymentVerificationAttempts
  ) {
    throw new Error("Deployment verification attempt count is invalid");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const health = record(
        await json(
          await fetcher(new URL("/api/health", origin), {
            cache: "no-store",
            redirect: "error",
          }),
        ),
        "Deployment health response is invalid",
      );
      if (
        health.ok !== true ||
        health.environment !== expectedRuntimeEnvironment ||
        health.version !== releaseTag ||
        health.commit !== gitSha
      ) {
        throw new Error("Deployment health metadata does not match release");
      }

      const library = record(
        await json(
          await fetcher(new URL(deploymentSmokePath, origin), {
            cache: "no-store",
            redirect: "error",
          }),
        ),
        "Deployment library response is invalid",
      );
      const pagination = record(
        library.pagination,
        "Deployment library pagination is invalid",
      );
      if (
        !Array.isArray(library.movies) ||
        library.movies.length > 25 ||
        pagination.page !== 1 ||
        pagination.pageSize !== 25
      ) {
        throw new Error("Deployment library smoke check failed");
      }
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(deploymentVerificationDelayMs);
    }
  }
};

export const verifyMaintenanceDeployment = async (
  fetcher: Fetcher,
  sleep: Sleep,
  baseUrl: string,
  releaseTag: string,
  gitSha: string,
  expectedTarget: string,
  attempts = deploymentVerificationAttempts,
) => {
  const origin = validateDeploymentTarget(
    baseUrl,
    releaseTag,
    gitSha,
    expectedTarget,
  );
  const expectedRuntimeEnvironment =
    deploymentTarget(expectedTarget).runtimeEnvironment;
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > deploymentVerificationAttempts
  ) {
    throw new Error("Deployment verification attempt count is invalid");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const healthResponse = await fetcher(new URL("/api/health", origin), {
        cache: "no-store",
        redirect: "error",
      });
      const health = record(
        await responseJson(healthResponse),
        "Maintenance health response is invalid",
      );
      if (
        healthResponse.status !== 503 ||
        health.ok !== false ||
        health.maintenance !== true ||
        health.environment !== expectedRuntimeEnvironment ||
        health.version !== releaseTag ||
        health.commit !== gitSha
      ) {
        throw new Error(
          "Maintenance deployment metadata does not match release",
        );
      }

      const catalogResponse = await fetcher(
        new URL(deploymentSmokePath, origin),
        {
          cache: "no-store",
          redirect: "error",
        },
      );
      const catalog = record(
        await responseJson(catalogResponse),
        "Maintenance catalog response is invalid",
      );
      if (catalogResponse.status !== 503 || catalog.maintenance !== true) {
        throw new Error(
          "Maintenance deployment did not block application routes",
        );
      }
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(deploymentVerificationDelayMs);
    }
  }
};

const migrationNames = (directory: string) =>
  readdirSync(resolve(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

const usage = () => {
  throw new Error(
    "Usage: release-gates.ts <validate-tag|validate-target|check-migrations|check-refresh-idle|check-refresh-disabled|check-production-family-bonding-empty|check-production-family-bonding-initial|check-production-family-bonding-populated|verify-deployment|verify-maintenance> ...",
  );
};

export const runReleaseGate = async (args: string[]) => {
  const [command, ...values] = args;
  if (command === "validate-tag" && values.length === 1) {
    if (!isReleaseTag(values[0])) throw new Error("Release tag is invalid");
    return;
  }
  if (command === "validate-target" && values.length === 4) {
    validateDeploymentTarget(values[0], values[1], values[2], values[3]);
    return;
  }
  if (command === "check-migrations" && values.length === 2) {
    assertReleaseMigrationsApplied(
      migrationNames(values[0]),
      JSON.parse(readFileSync(resolve(values[1]), "utf8")) as unknown,
    );
    return;
  }
  if (command === "check-refresh-idle" && values.length === 1) {
    assertTmdbRefreshIdle(
      JSON.parse(readFileSync(resolve(values[0]), "utf8")) as unknown,
    );
    return;
  }
  if (command === "check-refresh-disabled" && values.length === 1) {
    assertTmdbRefreshDisabled(
      JSON.parse(readFileSync(resolve(values[0]), "utf8")) as unknown,
    );
    return;
  }
  if (
    command === "check-production-family-bonding-populated" &&
    values.length === 1
  ) {
    assertFamilyBondingPopulated(
      JSON.parse(readFileSync(resolve(values[0]), "utf8")) as unknown,
    );
    return;
  }
  if (
    command === "check-production-family-bonding-initial" &&
    values.length === 1
  ) {
    assertFamilyBondingInitialCatalog(
      JSON.parse(readFileSync(resolve(values[0]), "utf8")) as unknown,
    );
    return;
  }
  if (
    command === "check-production-family-bonding-empty" &&
    values.length === 1
  ) {
    assertFamilyBondingEmpty(
      JSON.parse(readFileSync(resolve(values[0]), "utf8")) as unknown,
    );
    return;
  }
  if (command === "verify-deployment" && values.length === 4) {
    await verifyDeployment(
      fetch,
      (milliseconds) =>
        new Promise((resolvePromise) =>
          setTimeout(resolvePromise, milliseconds),
        ),
      values[0],
      values[1],
      values[2],
      values[3],
    );
    return;
  }
  if (command === "verify-maintenance" && values.length === 4) {
    await verifyMaintenanceDeployment(
      fetch,
      (milliseconds) =>
        new Promise((resolvePromise) =>
          setTimeout(resolvePromise, milliseconds),
        ),
      values[0],
      values[1],
      values[2],
      values[3],
    );
    return;
  }
  usage();
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  runReleaseGate(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Release gate failed",
    );
    process.exitCode = 1;
  });
}
