import {
  deploymentTarget,
  validateDeploymentTarget,
  verifyDeployment,
  verifyMaintenanceDeployment,
} from "./release-gates.ts";

export const verificationErrors = {
  input: "Deployment verification input is invalid",
  record: "Wrangler output does not identify the expected deployment version",
  credentials:
    "Cloudflare deployment verification credentials are missing or invalid",
  authorization: "Cloudflare API authorization failed",
  api: "Cloudflare deployment API request failed",
  domain: "Cloudflare domain does not map to the expected Worker",
  allocation: "Cloudflare has not assigned the expected version all traffic",
  version: "Cloudflare version metadata does not match the expected release",
  connection: "Authenticated Worker connection failed",
  runtime: "Deployed Worker did not pass the release and application checks",
  cleanup: "Authenticated Worker connection cleanup failed",
  timeout: "Authenticated deployment verification timed out",
  internal: "Authenticated deployment verification failed",
} as const;

export type VerificationCode = keyof typeof verificationErrors;

export class VerificationError extends Error {
  readonly code: VerificationCode;
  constructor(code: VerificationCode) {
    super(verificationErrors[code]);
    this.code = code;
  }
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export type DeploymentExpectation = {
  phase: "maintenance" | "active";
  baseUrl: string;
  releaseTag: string;
  gitSha: string;
  target: string;
  versionId: string;
};

export const validateExpectation = (expected: DeploymentExpectation) => {
  try {
    validateDeploymentTarget(
      expected.baseUrl,
      expected.releaseTag,
      expected.gitSha,
      expected.target,
    );
    if (
      !uuid(expected.versionId) ||
      !["maintenance", "active"].includes(expected.phase)
    )
      throw new Error();
  } catch {
    throw new VerificationError("input");
  }
};

// Read the successful upload's identity, not human-readable deployment logs.
export const deploymentVersion = (source: string, target: string) => {
  try {
    const records = source
      .trim()
      .split(/\r?\n/)
      .map((line) => object(JSON.parse(line)));
    const deployments = records.filter((entry) => entry.type === "deploy");
    const entry = deployments[0];
    if (
      deployments.length !== 1 ||
      entry.version !== 1 ||
      entry.worker_name !== deploymentTarget(target).worker ||
      !uuid(entry.version_id)
    )
      throw new Error();
    return entry.version_id;
  } catch {
    throw new VerificationError("record");
  }
};

export type CloudflareReader = (path: string) => Promise<unknown>;
export type WorkerConnection = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  dispose: () => Promise<void>;
};

export const assertCloudflareDeployment = async (
  expected: DeploymentExpectation,
  read: CloudflareReader,
) => {
  validateExpectation(expected);
  const target = deploymentTarget(expected.target);
  const hostname = new URL(target.origin).hostname;
  const domains = await read(
    `/domains?hostname=${encodeURIComponent(hostname)}`,
  );
  if (!Array.isArray(domains) || domains.length !== 1)
    throw new VerificationError("domain");
  const domain = object(domains[0]);
  // Wrangler environments are separate named Workers, each in its default
  // Cloudflare service environment. APP_ENV is validated separately below.
  if (
    domain.hostname !== hostname ||
    domain.service !== target.worker ||
    domain.environment !== "production" ||
    domain.enabled !== true
  )
    throw new VerificationError("domain");

  const prefix = `/scripts/${target.worker}`;
  const deployments = object(await read(`${prefix}/deployments`)).deployments;
  const latest = Array.isArray(deployments) ? object(deployments[0]) : {};
  const versions = latest.versions;
  if (
    !Array.isArray(versions) ||
    versions.length !== 1 ||
    object(versions[0]).version_id !== expected.versionId ||
    object(versions[0]).percentage !== 100
  )
    throw new VerificationError("allocation");

  const version = object(
    await read(`${prefix}/versions/${expected.versionId}`),
  );
  const bindings = object(version.resources).bindings;
  const expectedBindings = {
    APP_ENV: target.runtimeEnvironment,
    APP_VERSION: expected.releaseTag,
    GIT_SHA: expected.gitSha,
    MAINTENANCE_MODE: String(expected.phase === "maintenance"),
  };
  if (version.id !== expected.versionId || !Array.isArray(bindings))
    throw new VerificationError("version");
  for (const [name, value] of Object.entries(expectedBindings)) {
    const matches = bindings
      .map(object)
      .filter((binding) => binding.name === name);
    if (
      matches.length !== 1 ||
      matches[0].type !== "plain_text" ||
      matches[0].text !== value
    ) {
      throw new VerificationError("version");
    }
  }
};

export const verifyCloudflareDeployment = async (
  expected: DeploymentExpectation,
  read: CloudflareReader,
  connect: () => Promise<WorkerConnection>,
  sleep: (milliseconds: number) => Promise<void>,
  attempts = 13,
) => {
  validateExpectation(expected);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 13)
    throw new VerificationError("input");
  // Allow the just-uploaded version to appear, but never accept another one.
  for (let attempt = 1; ; attempt++) {
    try {
      await assertCloudflareDeployment(expected, read);
      break;
    } catch (error) {
      if (
        attempt === attempts ||
        !(error instanceof VerificationError) ||
        !["allocation", "version", "domain"].includes(error.code)
      )
        throw error;
      await sleep(5_000);
    }
  }
  let connection: WorkerConnection;
  try {
    connection = await connect();
  } catch {
    throw new VerificationError("connection");
  }
  let failure: unknown;
  try {
    const verify =
      expected.phase === "maintenance"
        ? verifyMaintenanceDeployment
        : verifyDeployment;
    try {
      await verify(
        (input, init) => connection.fetch(String(input), init),
        sleep,
        expected.baseUrl,
        expected.releaseTag,
        expected.gitSha,
        expected.target,
        attempts,
      );
    } catch {
      throw new VerificationError("runtime");
    }
    // Detect a deployment or domain change while the runtime checks were running.
    await assertCloudflareDeployment(expected, read);
  } catch (error) {
    failure = error;
  }
  try {
    await connection.dispose();
  } catch {
    failure ??= new VerificationError("cleanup");
  }
  if (failure) throw failure;
};
