import { describe, expect, it, vi } from "vitest";
import {
  assertCloudflareDeployment,
  deploymentVersion,
  validateExpectation,
  VerificationError,
  verificationErrors,
  verifyCloudflareDeployment,
  type DeploymentExpectation,
} from "./cloudflare-deployment";

const versionId = "11111111-2222-4333-8444-555555555555";
const otherVersionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const gitSha = "a".repeat(40);
const targets = [
  {
    target: "staging",
    baseUrl: "https://staging.ludovicotech.com",
    worker: "ludovico-tech-staging",
    runtime: "staging",
  },
  {
    target: "production",
    baseUrl: "https://ludovicotech.com",
    worker: "ludovico-tech-production",
    runtime: "production",
  },
  {
    target: "production-family-bonding",
    baseUrl: "https://familybonding.ludovicotech.com",
    worker: "ludovico-tech-production-family-bonding",
    runtime: "production",
  },
] as const;
const scenarios = targets.flatMap((target) =>
  (["maintenance", "active"] as const).map((phase) => ({ ...target, phase })),
);
type Scenario = (typeof scenarios)[number];

const expectation = (
  scenario: Scenario = scenarios[0],
): DeploymentExpectation => ({
  phase: scenario.phase,
  baseUrl: scenario.baseUrl,
  target: scenario.target,
  releaseTag: "v13.0.0",
  gitSha,
  versionId,
});

const fixture = (scenario: Scenario = scenarios[0]) => {
  const expected = expectation(scenario);
  const domain = {
    hostname: new URL(scenario.baseUrl).hostname,
    service: scenario.worker,
    environment: "production",
    enabled: true,
  };
  const allocation = {
    deployments: [{ versions: [{ version_id: versionId, percentage: 100 }] }],
  };
  const version = {
    id: versionId,
    resources: {
      bindings: [
        { name: "APP_ENV", type: "plain_text", text: scenario.runtime },
        { name: "APP_VERSION", type: "plain_text", text: "v13.0.0" },
        { name: "GIT_SHA", type: "plain_text", text: gitSha },
        {
          name: "MAINTENANCE_MODE",
          type: "plain_text",
          text: String(scenario.phase === "maintenance"),
        },
        { name: "PRIVATE_TOKEN", type: "secret_text" },
      ],
    },
  };
  const paths = {
    domain: `/domains?hostname=${domain.hostname}`,
    allocation: `/scripts/${scenario.worker}/deployments`,
    version: `/scripts/${scenario.worker}/versions/${versionId}`,
  };
  const responses: Record<string, unknown> = {
    [paths.domain]: [domain],
    [paths.allocation]: allocation,
    [paths.version]: version,
  };
  const read = vi.fn(async (path: string) => {
    if (!(path in responses)) throw new Error("Unexpected API path");
    return responses[path];
  });
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url) => {
      const path = new URL(url).pathname;
      if (scenario.phase === "maintenance") {
        return Response.json(
          path === "/api/health"
            ? {
                commit: gitSha,
                environment: scenario.runtime,
                maintenance: true,
                ok: false,
                version: "v13.0.0",
              }
            : { maintenance: true },
          { status: 503 },
        );
      }
      return Response.json(
        path === "/api/health"
          ? {
              commit: gitSha,
              environment: scenario.runtime,
              ok: true,
              version: "v13.0.0",
            }
          : { movies: [], pagination: { page: 1, pageSize: 25 } },
      );
    },
  );
  const dispose = vi.fn(async () => {});
  const connect = vi.fn(async () => ({ fetch, dispose }));
  const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => {});
  const verify = (attempts = 1) =>
    verifyCloudflareDeployment(expected, read, connect, sleep, attempts);
  return {
    expected,
    domain,
    allocation,
    version,
    paths,
    responses,
    read,
    fetch,
    dispose,
    connect,
    sleep,
    verify,
  };
};

describe("authenticated deployment inputs", () => {
  it.each(scenarios)("accepts $target $phase", (scenario) => {
    expect(() => validateExpectation(expectation(scenario))).not.toThrow();
  });

  it.each([
    { baseUrl: "https://ludovicotech.com" },
    { baseUrl: "https://staging.ludovicotech.com/api/health" },
    { baseUrl: "https://secret@staging.ludovicotech.com" },
    { target: "preview" },
    { phase: "prepare" },
    { releaseTag: "v13.0.0-preview" },
    { gitSha: "main" },
    { versionId: "../../versions/latest" },
    { versionId: "11111111-2222-4333-8444-55555555555Z" },
  ])("rejects malformed or mismatched expectations: %j", (override) => {
    expect(() =>
      validateExpectation({
        ...expectation(),
        ...override,
      } as DeploymentExpectation),
    ).toThrow(verificationErrors.input);
  });

  it.each(targets)(
    "reads one exact upload identity for $target",
    ({ target, worker }) => {
      const source = [
        JSON.stringify({ type: "progress", message: "Uploaded" }),
        JSON.stringify({
          type: "deploy",
          version: 1,
          worker_name: worker,
          version_id: versionId,
        }),
        "",
      ].join("\r\n");
      expect(deploymentVersion(source, target)).toBe(versionId);
    },
  );

  it("rejects malformed, missing, ambiguous, or wrong-Worker upload records", () => {
    const valid = {
      type: "deploy",
      version: 1,
      worker_name: "ludovico-tech-staging",
      version_id: versionId,
    };
    for (const source of [
      "",
      "Uploaded version 11111111-2222-4333-8444-555555555555",
      "null",
      "[]",
      "{}",
      JSON.stringify({ ...valid, worker_name: "ludovico-tech-production" }),
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, version_id: "latest" }),
      `${JSON.stringify(valid)}\n${JSON.stringify(valid)}`,
      `${JSON.stringify(valid)}\ninvalid JSON`,
    ]) {
      expect(() => deploymentVersion(source, "staging")).toThrow(
        verificationErrors.record,
      );
    }
    expect(() => deploymentVersion(JSON.stringify(valid), "preview")).toThrow(
      verificationErrors.record,
    );
  });
});

describe("Cloudflare deployment identity and allocation", () => {
  it.each(scenarios)(
    "checks the default service environment and runtime metadata for $target $phase",
    async (scenario) => {
      const f = fixture(scenario);
      await expect(
        assertCloudflareDeployment(f.expected, f.read),
      ).resolves.toBeUndefined();
      expect(f.read.mock.calls.map(([path]) => path)).toEqual(
        Object.values(f.paths),
      );
    },
  );

  it.each([null, [], [{ hostname: "staging.ludovicotech.com" }], [null]])(
    "rejects absent or malformed domain mappings: %j",
    async (domains) => {
      const f = fixture();
      f.responses[f.paths.domain] = domains;
      await expect(
        assertCloudflareDeployment(f.expected, f.read),
      ).rejects.toThrow(verificationErrors.domain);
      expect(f.read).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { hostname: "familybonding.ludovicotech.com" },
    { service: "ludovico-tech-production" },
    { environment: "staging" },
    { enabled: false },
    { enabled: undefined },
  ])("rejects a mismatched or disabled custom domain: %j", async (override) => {
    const f = fixture();
    f.responses[f.paths.domain] = [{ ...f.domain, ...override }];
    await expect(
      assertCloudflareDeployment(f.expected, f.read),
    ).rejects.toThrow(verificationErrors.domain);
  });

  it("rejects ambiguous domains even when one mapping matches", async () => {
    const f = fixture();
    f.responses[f.paths.domain] = [f.domain, f.domain];
    await expect(
      assertCloudflareDeployment(f.expected, f.read),
    ).rejects.toThrow(verificationErrors.domain);
  });

  it.each([
    null,
    {},
    { deployments: [] },
    { deployments: [null] },
    { deployments: [{ versions: [] }] },
    { deployments: [{ versions: [null] }] },
    {
      deployments: [
        { versions: [{ version_id: otherVersionId, percentage: 100 }] },
      ],
    },
    {
      deployments: [
        { versions: [{ version_id: versionId, percentage: "100" }] },
      ],
    },
    {
      deployments: [{ versions: [{ version_id: versionId, percentage: 99 }] }],
    },
    {
      deployments: [
        {
          versions: [
            { version_id: versionId, percentage: 50 },
            { version_id: otherVersionId, percentage: 50 },
          ],
        },
      ],
    },
  ])(
    "rejects missing, stale or split traffic allocation: %j",
    async (allocation) => {
      const f = fixture();
      f.responses[f.paths.allocation] = allocation;
      await expect(
        assertCloudflareDeployment(f.expected, f.read),
      ).rejects.toThrow(verificationErrors.allocation);
      expect(f.read).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["APP_ENV", "APP_VERSION", "GIT_SHA", "MAINTENANCE_MODE"])(
    "requires one exact plain-text %s binding",
    async (name) => {
      for (const mutation of [
        "missing",
        "duplicate",
        "wrong-type",
        "wrong-value",
      ] as const) {
        const f = fixture();
        const binding = f.version.resources.bindings.find(
          (entry) => entry.name === name,
        )!;
        if (mutation === "missing")
          f.version.resources.bindings = f.version.resources.bindings.filter(
            (entry) => entry !== binding,
          );
        if (mutation === "duplicate")
          f.version.resources.bindings.push({ ...binding });
        if (mutation === "wrong-type") binding.type = "secret_text";
        if (mutation === "wrong-value") binding.text = "incorrect";
        await expect(
          assertCloudflareDeployment(f.expected, f.read),
        ).rejects.toThrow(verificationErrors.version);
      }
    },
  );

  it.each([
    null,
    {},
    { id: otherVersionId, resources: { bindings: [] } },
    { id: versionId, resources: { bindings: null } },
  ])("rejects missing or mismatched version details: %j", async (version) => {
    const f = fixture();
    f.responses[f.paths.version] = version;
    await expect(
      assertCloudflareDeployment(f.expected, f.read),
    ).rejects.toThrow(verificationErrors.version);
  });
});

describe("authenticated runtime verification and connection lifecycle", () => {
  it.each(scenarios)(
    "runs real health and library assertions for $target $phase then disposes",
    async (scenario) => {
      const f = fixture(scenario);
      await expect(f.verify()).resolves.toBeUndefined();
      expect(f.fetch).toHaveBeenNthCalledWith(
        1,
        `${scenario.baseUrl}/api/health`,
        { cache: "no-store", redirect: "error" },
      );
      expect(f.fetch).toHaveBeenNthCalledWith(
        2,
        `${scenario.baseUrl}/api/library?direction=asc&page=1&pageSize=25&search=&sort=title&status=all`,
        { cache: "no-store", redirect: "error" },
      );
      expect(f.read.mock.calls.map(([path]) => path)).toEqual([
        ...Object.values(f.paths),
        ...Object.values(f.paths),
      ]);
      expect(f.dispose).toHaveBeenCalledTimes(1);
      expect(f.sleep).not.toHaveBeenCalled();
      expect(f.read.mock.invocationCallOrder[2]).toBeLessThan(
        f.connect.mock.invocationCallOrder[0],
      );
      expect(f.fetch.mock.invocationCallOrder[1]).toBeLessThan(
        f.read.mock.invocationCallOrder[3],
      );
      expect(f.read.mock.invocationCallOrder[5]).toBeLessThan(
        f.dispose.mock.invocationCallOrder[0],
      );
    },
  );

  it.each([0, 14, 1.5, NaN])(
    "rejects invalid attempt count %s before API or proxy calls",
    async (attempts) => {
      const f = fixture();
      await expect(f.verify(attempts)).rejects.toThrow(
        verificationErrors.input,
      );
      expect(f.read).not.toHaveBeenCalled();
      expect(f.connect).not.toHaveBeenCalled();
    },
  );

  it("retries initial propagation mismatches before connecting", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce([]);
    await expect(f.verify(2)).resolves.toBeUndefined();
    expect(f.sleep).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(f.connect).toHaveBeenCalledTimes(1);
  });

  it("stops bounded propagation retries without opening a connection", async () => {
    const f = fixture();
    f.allocation.deployments[0].versions[0].version_id = otherVersionId;
    await expect(f.verify(2)).rejects.toThrow(verificationErrors.allocation);
    expect(f.sleep).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.dispose).not.toHaveBeenCalled();
  });

  it.each([
    new VerificationError("authorization"),
    new Error("transport failure"),
  ])("does not retry API errors or connect after them", async (error) => {
    const f = fixture();
    f.read.mockRejectedValueOnce(error);
    await expect(f.verify(2)).rejects.toBe(error);
    expect(f.sleep).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });

  it("replaces connection errors with safe fixed diagnostics", async () => {
    const f = fixture();
    f.connect.mockRejectedValueOnce(
      new Error("temporary proxy token: private-value"),
    );
    await expect(f.verify()).rejects.toThrow(verificationErrors.connection);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.dispose).not.toHaveBeenCalled();
  });

  it.each(scenarios)(
    "fails and cleans up when the $target $phase runtime has stale metadata",
    async (scenario) => {
      const f = fixture(scenario);
      f.fetch.mockImplementation(async () =>
        Response.json({ commit: "b".repeat(40) }),
      );
      await expect(f.verify(2)).rejects.toThrow(verificationErrors.runtime);
      expect(f.fetch).toHaveBeenCalledTimes(2);
      expect(f.sleep).toHaveBeenCalledExactlyOnceWith(5_000);
      expect(f.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["maintenance", "active"] as const)(
    "requires the %s application assertion after valid health",
    async (phase) => {
      const f = fixture(
        scenarios.find((scenario) => scenario.phase === phase)!,
      );
      const original = f.fetch.getMockImplementation()!;
      f.fetch.mockImplementation((url, init) =>
        url.includes("/api/library")
          ? Promise.resolve(
              Response.json({ unexpected: "private catalog failure" }),
            )
          : original(url, init),
      );
      await expect(f.verify()).rejects.toThrow(verificationErrors.runtime);
      expect(f.fetch).toHaveBeenCalledTimes(2);
      expect(f.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it("retries transient runtime errors using the same connection", async () => {
    const f = fixture();
    f.fetch.mockRejectedValueOnce(new Error("transient connection failure"));
    await expect(f.verify(2)).resolves.toBeUndefined();
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(f.sleep).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects an allocation change during runtime verification and still disposes", async () => {
    const f = fixture();
    const original = f.fetch.getMockImplementation()!;
    f.fetch.mockImplementation(async (url, init) => {
      const result = await original(url, init);
      if (url.includes("/api/library"))
        f.allocation.deployments[0].versions[0].version_id = otherVersionId;
      return result;
    });
    await expect(f.verify(2)).rejects.toThrow(verificationErrors.allocation);
    expect(f.sleep).not.toHaveBeenCalled();
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports failed cleanup without leaking its private error", async () => {
    const f = fixture();
    f.dispose.mockRejectedValueOnce(new Error("proxy authorization: secret"));
    await expect(f.verify()).rejects.toThrow(verificationErrors.cleanup);
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });
});
