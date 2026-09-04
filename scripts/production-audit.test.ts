import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyProductionAudit,
  reportProductionAudit,
  type ProductionAuditCommandResult,
} from "./production-audit";

const report = (high = 0, critical = 0) =>
  JSON.stringify({
    metadata: {
      vulnerabilities: { critical, high, info: 0, low: 0, moderate: 0 },
    },
  });

const result = (
  overrides: Partial<ProductionAuditCommandResult> = {},
): ProductionAuditCommandResult => ({
  status: 0,
  stderr: "",
  stdout: report(),
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe("production dependency audit", () => {
  it("passes a completed clean audit", () => {
    const outcome = classifyProductionAudit(result());

    expect(outcome).toEqual({ kind: "clean" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(reportProductionAudit(result(), outcome)).toBe(0);
  });

  it("fails when a completed audit reports high or critical findings", () => {
    const auditResult = result({
      status: 1,
      stderr: "A previous request returned HTTP 503 before succeeding.",
      stdout: report(2, 1),
    });
    const outcome = classifyProductionAudit(auditResult);

    expect(outcome).toEqual({ kind: "findings", high: 2, critical: 1 });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(reportProductionAudit(auditResult, outcome)).toBe(1);
  });

  it.each([
    ["timeout", "TimeoutError: The operation was aborted due to timeout"],
    ["server-error", "POST advisories/bulk error (503)"],
    ["server-error", "HTTP/2 502 Bad Gateway"],
  ] as const)(
    "warns and continues after a recognized %s failure",
    (reason, stderr) => {
      const auditResult = result({ status: 1, stderr, stdout: "" });
      const outcome = classifyProductionAudit(auditResult);

      expect(outcome).toEqual({ kind: "transient-error", reason });
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(reportProductionAudit(auditResult, outcome)).toBe(0);
    },
  );

  it.each([
    "HTTP 401 Unauthorized",
    "ERR_PNPM_BROKEN_LOCKFILE",
    "Unknown option: --fetch-timeout",
  ])("fails closed for an unrecognized audit failure: %s", (stderr) => {
    const auditResult = result({ status: 1, stderr, stdout: "" });
    const outcome = classifyProductionAudit(auditResult);

    expect(outcome).toEqual({ kind: "failure" });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(reportProductionAudit(auditResult, outcome)).toBe(1);
  });

  it("fails closed when a successful command returns a malformed report", () => {
    expect(
      classifyProductionAudit(result({ status: 0, stdout: "not-json" })),
    ).toEqual({ kind: "failure" });
    expect(
      classifyProductionAudit(
        result({
          status: 0,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { high: -1 } },
          }),
        }),
      ),
    ).toEqual({ kind: "failure" });
  });
});
