import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ProductionAuditCommandResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout: string;
}

export type ProductionAuditOutcome =
  | { kind: "clean" }
  | { kind: "findings"; critical: number; high: number }
  | { kind: "transient-error"; reason: "server-error" | "timeout" }
  | { kind: "failure" };

const transientTimeout =
  /(?:TimeoutError|ETIMEDOUT|ESOCKETTIMEDOUT|ERR_[A-Z_]*TIMEOUT|UND_ERR_[A-Z_]*TIMEOUT|timed out|aborted due to timeout|request timeout)/i;
const transientServerError =
  /(?:HTTP(?:\/\d(?:\.\d)?)?\s*|status(?: code)?\s*[:=]?\s*|response(?: code| status)?\s*[:=]?\s*|error\s*\(\s*)5\d{2}\b/i;

const severityCounts = (source: string) => {
  try {
    const report = JSON.parse(source) as {
      metadata?: { vulnerabilities?: Record<string, unknown> };
    };
    const vulnerabilities = report.metadata?.vulnerabilities;
    const high = vulnerabilities?.high;
    const critical = vulnerabilities?.critical;
    if (
      typeof high !== "number" ||
      !Number.isSafeInteger(high) ||
      high < 0 ||
      typeof critical !== "number" ||
      !Number.isSafeInteger(critical) ||
      critical < 0
    ) {
      return null;
    }
    return { critical, high };
  } catch {
    return null;
  }
};

export const classifyProductionAudit = (
  result: ProductionAuditCommandResult,
): ProductionAuditOutcome => {
  const counts = severityCounts(result.stdout);
  if (counts && (counts.high > 0 || counts.critical > 0)) {
    return { kind: "findings", ...counts };
  }

  if (result.status === 0 && counts) return { kind: "clean" };

  const diagnostics = [result.stderr, result.stdout, result.error?.message]
    .filter(Boolean)
    .join("\n");
  if (transientTimeout.test(diagnostics)) {
    return { kind: "transient-error", reason: "timeout" };
  }
  if (transientServerError.test(diagnostics)) {
    return { kind: "transient-error", reason: "server-error" };
  }
  return { kind: "failure" };
};

export const runProductionAuditCommand = (): ProductionAuditCommandResult => {
  const result = spawnSync(
    "pnpm",
    ["audit", "--prod", "--audit-level", "high", "--json"],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
};

export const reportProductionAudit = (
  result: ProductionAuditCommandResult,
  outcome: ProductionAuditOutcome,
) => {
  if (outcome.kind === "clean") {
    console.log(
      "Production dependency audit passed with no high or critical findings.",
    );
    return 0;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (outcome.kind === "transient-error") {
    const reason =
      outcome.reason === "timeout" ? "timed out" : "returned an HTTP 5xx error";
    console.warn(
      `::warning title=Production dependency audit unavailable::The advisory service ${reason}; continuing without a fresh audit result.`,
    );
    return 0;
  }

  if (outcome.kind === "findings") {
    console.error(
      `Production dependency audit found ${outcome.high} high and ${outcome.critical} critical vulnerabilities.`,
    );
  } else {
    console.error(
      "Production dependency audit failed without a recognized timeout or HTTP 5xx response.",
    );
  }
  return 1;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const result = runProductionAuditCommand();
  process.exitCode = reportProductionAudit(
    result,
    classifyProductionAudit(result),
  );
}
