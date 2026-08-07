import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const releaseTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const gitShaPattern = /^[0-9a-f]{40}$/;

export const isReleaseTag = (value: string) => releaseTagPattern.test(value);

const deploymentBaseUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Production base URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Production base URL must be an HTTPS origin");
  }
  return url;
};

export const validateDeploymentTarget = (
  baseUrl: string,
  releaseTag: string,
  gitSha: string,
) => {
  const url = deploymentBaseUrl(baseUrl);
  if (!isReleaseTag(releaseTag)) throw new Error("Release tag is invalid");
  if (!gitShaPattern.test(gitSha)) throw new Error("Commit SHA is invalid");
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
      `Production has ${pending.length} pending release migration${pending.length === 1 ? "" : "s"}`,
    );
  }
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Sleep = (milliseconds: number) => Promise<void>;

const json = async (response: Response) => {
  if (!response.ok) throw new Error("Deployment endpoint is not ready");
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
  attempts = 6,
) => {
  const origin = validateDeploymentTarget(baseUrl, releaseTag, gitSha);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
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
        health.environment !== "production" ||
        health.version !== releaseTag ||
        health.commit !== gitSha
      ) {
        throw new Error("Deployment health metadata does not match release");
      }

      const catalog = record(
        await json(
          await fetcher(new URL("/api/movies", origin), {
            cache: "no-store",
            redirect: "error",
          }),
        ),
        "Deployment catalog response is invalid",
      );
      if (!Array.isArray(catalog.movies)) {
        throw new Error("Deployment catalog smoke check failed");
      }
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(5_000);
    }
  }
};

const migrationNames = (directory: string) =>
  readdirSync(resolve(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

const usage = () => {
  throw new Error(
    "Usage: release-gates.ts <validate-tag|validate-target|check-migrations|verify-deployment> ...",
  );
};

export const runReleaseGate = async (args: string[]) => {
  const [command, ...values] = args;
  if (command === "validate-tag" && values.length === 1) {
    if (!isReleaseTag(values[0])) throw new Error("Release tag is invalid");
    return;
  }
  if (command === "validate-target" && values.length === 3) {
    validateDeploymentTarget(values[0], values[1], values[2]);
    return;
  }
  if (command === "check-migrations" && values.length === 2) {
    assertReleaseMigrationsApplied(
      migrationNames(values[0]),
      JSON.parse(readFileSync(resolve(values[1]), "utf8")) as unknown,
    );
    return;
  }
  if (command === "verify-deployment" && values.length === 3) {
    await verifyDeployment(
      fetch,
      (milliseconds) =>
        new Promise((resolvePromise) =>
          setTimeout(resolvePromise, milliseconds),
        ),
      values[0],
      values[1],
      values[2],
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
