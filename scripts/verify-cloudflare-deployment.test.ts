import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCloudflareReader,
  expectationFromArguments,
  runIsolatedProbe,
} from "./verify-cloudflare-deployment";

const directories: string[] = [];
const fixture = async (name: string, content: string) => {
  const directory = await mkdtemp(join(tmpdir(), "verification-test-"));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Cloudflare API credential and diagnostic boundary", () => {
  it("sends credentials only to the authenticated API and refuses redirects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ success: true, result: ["expected"] }),
      );
    const read = createCloudflareReader("a".repeat(32), "test-token", fetcher);
    expect(await read("/domains?hostname=staging.ludovicotech.com")).toEqual([
      "expected",
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/domains?hostname=staging.ludovicotech.com`,
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([401, 403, 500])(
    "does not expose the API response body for HTTP %s",
    async (status) => {
      const read = createCloudflareReader(
        "a".repeat(32),
        "test-token",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("private-token-and-data", { status }),
          ),
      );
      await expect(read("/domains")).rejects.toMatchObject({
        code: status === 500 ? "api" : "authorization",
      });
    },
  );
  it.each([
    "not-json",
    JSON.stringify({ success: false, errors: ["private-token"] }),
    "null",
  ])(
    "rejects unsafe/malformed envelopes without their contents",
    async (body) => {
      const read = createCloudflareReader(
        "a".repeat(32),
        "test-token",
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      );
      await expect(read("/domains")).rejects.toThrow(
        "Cloudflare deployment API request failed",
      );
    },
  );
  it("does not expose transport errors containing credentials", async () => {
    const read = createCloudflareReader(
      "a".repeat(32),
      "test-token",
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("request contained private-token")),
    );
    await expect(read("/domains")).rejects.toThrow(
      "Cloudflare deployment API request failed",
    );
  });
  it("rejects missing credentials before making any request", () => {
    expect(() =>
      createCloudflareReader("../../other-account", "token"),
    ).toThrow("credentials");
    expect(() => createCloudflareReader("a".repeat(32), "")).toThrow(
      "credentials",
    );
  });
});

describe("trusted verifier process", () => {
  it("keeps raw SDK stdout and stderr out of the outer process output", async () => {
    const script = await fixture(
      "probe.cjs",
      `
        const { writeSync } = require("node:fs");
        writeSync(1, "sensitive-proxy-token-stdout\\n");
        writeSync(2, "sensitive-api-response-stderr\\n");
        process.send("authorization");
        process.exitCode = 1;
        process.disconnect();
      `,
    );
    const verifierUrl = new URL(
      "./verify-cloudflare-deployment.ts",
      import.meta.url,
    ).href;
    const outer = await fixture(
      "outer.mjs",
      `
        import { runIsolatedProbe } from ${JSON.stringify(verifierUrl)};
        try {
          await runIsolatedProbe([], { script: ${JSON.stringify(script)} });
        } catch (error) {
          console.error(error.message);
        }
      `,
    );

    const { stdout, stderr } = await promisify(execFile)(process.execPath, [
      outer,
    ]);

    expect(stdout).toBe("");
    expect(stderr).toBe("Cloudflare API authorization failed\n");
    expect(stdout + stderr).not.toContain("sensitive-proxy-token-stdout");
    expect(stdout + stderr).not.toContain("sensitive-api-response-stderr");
  });

  it.each(["timeout", "crash"])(
    "removes private SDK files after a probe %s",
    async (outcome) => {
      const marker = await fixture("temp-path.json", "");
      const script = await fixture(
        "probe.cjs",
        `
          const { writeFileSync } = require("node:fs");
          writeFileSync(process.env.WRANGLER_LOG_PATH, "sensitive-proxy-token");
          writeFileSync(process.argv[3], JSON.stringify({
            directory: process.env.LUDOVICO_VERIFICATION_TEMP,
            logPath: process.env.WRANGLER_LOG_PATH,
            writeLogs: process.env.WRANGLER_WRITE_LOGS,
          }));
          ${outcome === "crash" ? "process.exit(1);" : "setInterval(() => {}, 1000);"}
        `,
      );

      await expect(
        runIsolatedProbe([marker], { script, timeoutMs: 1_000 }),
      ).rejects.toMatchObject({
        code: outcome === "timeout" ? "timeout" : "internal",
      });

      const observed = JSON.parse(await readFile(marker, "utf8")) as {
        directory: string;
        logPath: string;
        writeLogs: string;
      };
      expect(observed.logPath).toBe(join(observed.directory, "wrangler.log"));
      expect(observed.writeLogs).toBe("false");
      await expect(stat(observed.directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("accepts a successful probe despite SDK diagnostic output", async () => {
    const script = await fixture(
      "probe.cjs",
      `console.log('private-token'); console.error('private-response'); process.send('ok'); process.disconnect();`,
    );
    await expect(runIsolatedProbe([], { script })).resolves.toBeUndefined();
  });
  it("exposes only a recognized error code despite unsafe SDK output", async () => {
    const script = await fixture(
      "probe.cjs",
      `console.error('private-token'); process.send('authorization'); process.exitCode=1; process.disconnect();`,
    );
    await expect(runIsolatedProbe([], { script })).rejects.toThrow(
      "Cloudflare API authorization failed",
    );
  });
  it.each(["private-token", "__proto__", "ok"])(
    "rejects untrusted diagnostics or unsuccessful exits (%s)",
    async (message) => {
      const script = await fixture(
        "probe.cjs",
        `process.send(${JSON.stringify(message)}); process.exitCode=1; process.disconnect();`,
      );
      await expect(runIsolatedProbe([], { script })).rejects.toThrow(
        "Authenticated deployment verification failed",
      );
    },
  );
  it("bounds a stalled SDK session", async () => {
    const script = await fixture("probe.cjs", "setInterval(() => {}, 1000);");
    await expect(
      runIsolatedProbe([], { script, timeoutMs: 100 }),
    ).rejects.toThrow("timed out");
  });
  it("requires a successful result as well as exit status zero", async () => {
    const script = await fixture("probe.cjs", "process.disconnect();");
    await expect(runIsolatedProbe([], { script })).rejects.toThrow(
      "Authenticated deployment verification failed",
    );
  });
  it("uses the exact Wrangler deployment output for CLI expectations", async () => {
    const version = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const path = await fixture(
      "deployment.ndjson",
      JSON.stringify({
        type: "deploy",
        version: 1,
        worker_name: "ludovico-tech-staging",
        version_id: version,
      }),
    );
    expect(
      await expectationFromArguments([
        "maintenance",
        "https://staging.ludovicotech.com",
        "v13.0.0",
        "a".repeat(40),
        "staging",
        path,
      ]),
    ).toMatchObject({ versionId: version, phase: "maintenance" });
    await expect(expectationFromArguments([])).rejects.toMatchObject({
      code: "input",
    });
    await expect(
      expectationFromArguments([
        "active",
        "url",
        "tag",
        "sha",
        "target",
        path + ".missing",
      ]),
    ).rejects.toMatchObject({ code: "record" });
  });
});
