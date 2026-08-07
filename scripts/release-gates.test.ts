import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReleaseMigrationsApplied,
  isReleaseTag,
  runReleaseGate,
  validateDeploymentTarget,
  verifyDeployment,
} from "./release-gates";

describe("release input validation", () => {
  it("accepts only exact stable semantic-release tags", () => {
    expect(isReleaseTag("v0.2.3")).toBe(true);
    expect(isReleaseTag("v10.20.30")).toBe(true);
    for (const value of [
      "main",
      "v1.2",
      "v1.2.3-extra",
      "v1.2.3/other",
      "v01.2.3",
      "refs/tags/v1.2.3",
    ]) {
      expect(isReleaseTag(value)).toBe(false);
    }
  });

  it("requires an HTTPS origin and a full commit SHA", () => {
    expect(
      validateDeploymentTarget(
        "https://movies.example.test",
        "v1.2.3",
        "a".repeat(40),
      ).origin,
    ).toBe("https://movies.example.test");
    for (const baseUrl of [
      "http://movies.example.test",
      "https://user@movies.example.test",
      "https://movies.example.test/path",
    ]) {
      expect(() =>
        validateDeploymentTarget(baseUrl, "v1.2.3", "a".repeat(40)),
      ).toThrow();
    }
  });

  it("wires strict tag, target, and migration CLI commands", async () => {
    await expect(runReleaseGate(["validate-tag", "v1.2.3"])).resolves.toBe(
      undefined,
    );
    await expect(
      runReleaseGate(["validate-tag", "v1.2.3-extra"]),
    ).rejects.toThrow("Release tag is invalid");
    await expect(
      runReleaseGate([
        "validate-target",
        "https://movies.example.test",
        "v1.2.3",
        "a".repeat(40),
      ]),
    ).resolves.toBeUndefined();

    const directory = mkdtempSync(join(tmpdir(), "release-gates-"));
    const report = join(directory, "applied.json");
    writeFileSync(join(directory, "0001_initial.sql"), "SELECT 1;\n");
    writeFileSync(
      report,
      JSON.stringify([
        { results: [{ name: "0001_initial.sql" }], success: true },
      ]),
    );
    await expect(
      runReleaseGate(["check-migrations", directory, report]),
    ).resolves.toBeUndefined();
    await expect(runReleaseGate(["unknown"])).rejects.toThrow("Usage:");
  });
});

describe("production migration gate", () => {
  const response = (names: string[]) => [
    {
      results: names.map((name) => ({ name })),
      success: true,
    },
  ];

  it("accepts an exact applied migration set", () => {
    expect(() =>
      assertReleaseMigrationsApplied(
        ["0001_initial.sql", "0002_next.sql"],
        response(["0002_next.sql", "0001_initial.sql"]),
      ),
    ).not.toThrow();
  });

  it("blocks pending or malformed migration state", () => {
    expect(() =>
      assertReleaseMigrationsApplied(
        ["0001_initial.sql", "0002_next.sql"],
        response(["0001_initial.sql"]),
      ),
    ).toThrow("1 pending release migration");
    expect(() =>
      assertReleaseMigrationsApplied(
        ["0001_initial.sql"],
        response(["0001_initial.sql", "0002_future.sql"]),
      ),
    ).not.toThrow();
    expect(() => assertReleaseMigrationsApplied([], {})).toThrow();
    expect(() => assertReleaseMigrationsApplied([], response([]))).toThrow(
      "Release migration set is invalid",
    );
  });
});

describe("deployed release verification", () => {
  const baseUrl = "https://movies.example.test";
  const releaseTag = "v1.2.3";
  const gitSha = "b".repeat(40);

  it("checks exact health metadata and the public catalog", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("not ready", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          commit: gitSha,
          environment: "staging",
          ok: true,
          version: releaseTag,
        }),
      )
      .mockResolvedValueOnce(Response.json({ movies: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await verifyDeployment(
      fetcher,
      sleep,
      baseUrl,
      releaseTag,
      gitSha,
      "staging",
      2,
    );

    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      new URL("/api/health", baseUrl),
      { cache: "no-store", redirect: "error" },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      new URL("/api/movies", baseUrl),
      { cache: "no-store", redirect: "error" },
    );
  });

  it("fails after bounded mismatches without calling a real network", async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      Response.json({
        commit: "c".repeat(40),
        environment: "staging",
        ok: true,
        version: releaseTag,
      }),
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyDeployment(
        fetcher,
        sleep,
        baseUrl,
        releaseTag,
        gitSha,
        "staging",
        2,
      ),
    ).rejects.toThrow("health metadata");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed smoke responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(null));
    await expect(
      verifyDeployment(
        fetcher,
        vi.fn().mockResolvedValue(undefined),
        baseUrl,
        releaseTag,
        gitSha,
        "staging",
        1,
      ),
    ).rejects.toThrow("health response is invalid");
  });

  it("rejects an unknown deployment environment", async () => {
    await expect(
      verifyDeployment(
        vi.fn(),
        vi.fn(),
        baseUrl,
        releaseTag,
        gitSha,
        "preview",
        1,
      ),
    ).rejects.toThrow("Deployment environment is invalid");
  });
});
