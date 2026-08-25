import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReleaseMigrationsApplied,
  assertTmdbRefreshPaused,
  isReleaseTag,
  runReleaseGate,
  validateDeploymentTarget,
  verifyDeployment,
  verifyMaintenanceDeployment,
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

  it("requires the exact HTTPS origin for the deployment environment", () => {
    expect(
      validateDeploymentTarget(
        "https://staging.ludovicotech.com",
        "v1.2.3",
        "a".repeat(40),
        "staging",
      ).origin,
    ).toBe("https://staging.ludovicotech.com");
    for (const baseUrl of [
      "http://movies.example.test",
      "https://user@movies.example.test",
      "https://movies.example.test/path",
    ]) {
      expect(() =>
        validateDeploymentTarget(baseUrl, "v1.2.3", "a".repeat(40), "staging"),
      ).toThrow();
    }
    expect(() =>
      validateDeploymentTarget(
        "https://ludovico-tech-staging.mayesidev.workers.dev",
        "v1.2.3",
        "a".repeat(40),
        "staging",
      ),
    ).toThrow("does not match");
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
        "https://staging.ludovicotech.com",
        "v1.2.3",
        "a".repeat(40),
        "staging",
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

describe("release migration gate", () => {
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

  it("blocks migration sets that are behind, ahead, or malformed", () => {
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
    ).toThrow("1 migration not present in release");
    expect(() => assertReleaseMigrationsApplied([], {})).toThrow();
    expect(() => assertReleaseMigrationsApplied([], response([]))).toThrow(
      "Release migration set is invalid",
    );
  });
});

describe("production refresh gate", () => {
  const response = (enabled: number, lease: string | null) => [
    {
      results: [{ enabled, lease_expires_at: lease }],
      success: true,
    },
  ];

  it("requires a paused schedule with no active lease", () => {
    expect(() => assertTmdbRefreshPaused(response(0, null))).not.toThrow();
    expect(() => assertTmdbRefreshPaused(response(1, null))).toThrow(
      "must be paused",
    );
    expect(() =>
      assertTmdbRefreshPaused(response(0, "2026-08-25T02:00:00.000Z")),
    ).toThrow("no active lease");
    expect(() => assertTmdbRefreshPaused([])).toThrow("invalid");
  });
});

describe("deployed release verification", () => {
  const baseUrl = "https://staging.ludovicotech.com";
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

  it("allows a bounded minute for a new release to reach the stable hostname", async () => {
    const previousRelease = {
      commit: "c".repeat(40),
      environment: "staging",
      ok: true,
      version: "v1.2.2",
    };
    const currentRelease = {
      commit: gitSha,
      environment: "staging",
      ok: true,
      version: releaseTag,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(previousRelease))
      .mockResolvedValueOnce(Response.json(previousRelease))
      .mockResolvedValueOnce(Response.json(previousRelease))
      .mockResolvedValueOnce(Response.json(previousRelease))
      .mockResolvedValueOnce(Response.json(previousRelease))
      .mockResolvedValueOnce(Response.json(previousRelease))
      .mockResolvedValueOnce(Response.json(currentRelease))
      .mockResolvedValueOnce(Response.json({ movies: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await verifyDeployment(
      fetcher,
      sleep,
      baseUrl,
      releaseTag,
      gitSha,
      "staging",
    );

    expect(sleep).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(fetcher).toHaveBeenCalledTimes(8);
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

describe("maintenance release verification", () => {
  const baseUrl = "https://ludovicotech.com";
  const releaseTag = "v5.0.3";
  const gitSha = "d".repeat(40);

  it("requires the exact release identity and blocks application routes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            commit: gitSha,
            environment: "production",
            maintenance: true,
            ok: false,
            version: releaseTag,
          },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ maintenance: true }, { status: 503 }),
      );

    await verifyMaintenanceDeployment(
      fetcher,
      vi.fn(),
      baseUrl,
      releaseTag,
      gitSha,
      "production",
      1,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      new URL("/api/health", baseUrl),
      { cache: "no-store", redirect: "error" },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      new URL("/api/movies", baseUrl),
      { cache: "no-store", redirect: "error" },
    );
  });

  it("rejects a normal or mismatched deployment", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        commit: gitSha,
        environment: "production",
        ok: true,
        version: releaseTag,
      }),
    );
    await expect(
      verifyMaintenanceDeployment(
        fetcher,
        vi.fn(),
        baseUrl,
        releaseTag,
        gitSha,
        "production",
        1,
      ),
    ).rejects.toThrow("does not match release");
  });
});
