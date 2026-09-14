import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { GetPlatformProxyOptions } from "wrangler";
import {
  deploymentVersion,
  validateExpectation,
  verificationErrors,
  VerificationError,
  verifyCloudflareDeployment,
  type CloudflareReader,
  type DeploymentExpectation,
  type WorkerConnection,
} from "./cloudflare-deployment.ts";
import { deploymentTarget } from "./release-gates.ts";

const scriptPath = fileURLToPath(import.meta.url);

export const createCloudflareReader = (
  accountId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): CloudflareReader => {
  if (!/^[a-f0-9]{32}$/.test(accountId) || !token.trim()) {
    throw new VerificationError("credentials");
  }
  return async (path) => {
    try {
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers${path}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw new VerificationError("authorization");
      }
      if (!response.ok) throw new VerificationError("api");
      const envelope: unknown = await response.json();
      if (
        !envelope ||
        typeof envelope !== "object" ||
        !("success" in envelope) ||
        envelope.success !== true ||
        !("result" in envelope)
      )
        throw new VerificationError("api");
      return envelope.result;
    } catch (error) {
      // API error bodies and transport errors can contain request/credential data.
      throw error instanceof VerificationError
        ? error
        : new VerificationError("api");
    }
  };
};

export const expectationFromArguments = async (args: string[]) => {
  if (args.length !== 6) throw new VerificationError("input");
  const [phase, baseUrl, releaseTag, gitSha, target, recordPath] = args;
  let source: string;
  try {
    source = await readFile(recordPath, "utf8");
  } catch {
    throw new VerificationError("record");
  }
  const expected = {
    phase: phase as DeploymentExpectation["phase"],
    baseUrl,
    releaseTag,
    gitSha,
    target,
    versionId: deploymentVersion(source, target),
  };
  validateExpectation(expected);
  return expected;
};

const openWorkerConnection = async (
  expected: DeploymentExpectation,
  accountId: string,
): Promise<WorkerConnection> => {
  const directory = process.env.LUDOVICO_VERIFICATION_TEMP;
  if (!directory) throw new VerificationError("connection");
  try {
    // The gate is preserved from main in RUNNER_TEMP. Resolve the already-pinned
    // SDK from the installed release checkout, independently of this file's path.
    const require = createRequire(resolve("package.json"));
    const sdk = (await import(
      pathToFileURL(require.resolve("wrangler")).href
    )) as {
      getPlatformProxy: (options: GetPlatformProxyOptions) => Promise<{
        env: { TARGET: { fetch: WorkerConnection["fetch"] } };
        dispose: () => Promise<void>;
      }>;
    };
    const configPath = join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "ludovico-deployment-verification",
        account_id: accountId,
        compatibility_date: "2026-08-03",
        workers_dev: false,
        preview_urls: false,
        services: [
          {
            binding: "TARGET",
            service: deploymentTarget(expected.target).worker,
            remote: true,
          },
        ],
      }),
      { mode: 0o600 },
    );
    delete process.env.WRANGLER_OUTPUT_FILE_PATH;
    delete process.env.WRANGLER_OUTPUT_FILE_DIRECTORY;
    const platform = await sdk.getPlatformProxy({
      configPath,
      persist: false,
      envFiles: [],
      remoteBindings: true,
    });
    return {
      fetch: (url, init) => platform.env.TARGET.fetch(url, init),
      dispose: async () => {
        try {
          await platform.dispose();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new VerificationError("connection");
  }
};

// SDK stdout/stderr are intentionally not forwarded. A fixed IPC vocabulary is
// the only diagnostic channel: temporary proxy tokens must never reach CI logs.
export const runIsolatedProbe = async (
  args: string[],
  options: { script?: string; timeoutMs?: number } = {},
): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "deployment-verification-"));
  try {
    await new Promise<void>((resolveProbe, reject) => {
      const child = fork(options.script ?? scriptPath, ["--probe", ...args], {
        execArgv: [],
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          ...process.env,
          CI: "true",
          // Set before importing Wrangler; its log path is initialized at import.
          WRANGLER_LOG: "none",
          WRANGLER_WRITE_LOGS: "false",
          WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
          WRANGLER_SEND_METRICS: "false",
          LUDOVICO_VERIFICATION_TEMP: directory,
        },
      });
      let result: "ok" | keyof typeof verificationErrors = "internal";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // Terminate the proxy runtime as well as Node if the SDK cannot finish.
        try {
          if (process.platform !== "win32" && child.pid)
            process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, options.timeoutMs ?? 240_000);
      child.on("message", (message: unknown) => {
        if (message === "ok") result = "ok";
        else if (
          typeof message === "string" &&
          Object.hasOwn(verificationErrors, message)
        ) {
          result = message as keyof typeof verificationErrors;
        }
      });
      child.once("error", () => {
        clearTimeout(timer);
        reject(new VerificationError("internal"));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (timedOut) reject(new VerificationError("timeout"));
        else if (code === 0 && result === "ok") resolveProbe();
        else
          reject(new VerificationError(result === "ok" ? "internal" : result));
      });
    });
  } finally {
    // Parent owns cleanup even if the SDK times out or the child crashes.
    await rm(directory, { recursive: true, force: true });
  }
};

const run = async () => {
  const args = process.argv.slice(2);
  if (args[0] === "--probe") {
    try {
      const expected = await expectationFromArguments(args.slice(1));
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
      const read = createCloudflareReader(
        accountId,
        process.env.CLOUDFLARE_API_TOKEN ?? "",
      );
      await verifyCloudflareDeployment(
        expected,
        read,
        () => openWorkerConnection(expected, accountId),
        sleep,
      );
      process.send?.("ok");
    } catch (error) {
      process.send?.(
        error instanceof VerificationError ? error.code : "internal",
      );
      process.exitCode = 1;
    } finally {
      process.disconnect?.();
    }
  } else {
    await runIsolatedProbe(args);
    console.info(
      "Authenticated deployment and application verification passed",
    );
  }
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  run().catch((error: unknown) => {
    console.error(
      error instanceof VerificationError
        ? error.message
        : verificationErrors.internal,
    );
    process.exitCode = 1;
  });
}
