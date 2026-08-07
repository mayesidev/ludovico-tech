import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowDirectory = resolve(".github/workflows");
const workflow = (name: string) =>
  readFileSync(join(workflowDirectory, name), "utf8");

describe("GitHub Actions supply-chain boundary", () => {
  it("pins every third-party action to a full commit SHA", () => {
    const sources = readdirSync(workflowDirectory)
      .filter((name) => name.endsWith(".yml"))
      .map(workflow);
    const references = sources.flatMap((source) =>
      [...source.matchAll(/^\s*uses:\s+\S+@(\S+)/gm)].map((match) => match[1]),
    );

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

describe("complete CI and production gates", () => {
  it("keeps coverage, browser, audit, and license checks in the stable verify job", () => {
    const source = workflow("ci.yml");
    expect(source).toContain("verify:");
    expect(source).toContain("run: pnpm config:check");
    expect(source).toContain("run: pnpm test:coverage");
    expect(source).toContain("run: pnpm test:e2e");
    expect(source).toContain("run: pnpm audit:production");
    expect(source).toContain("run: pnpm licenses:check");
    expect(source).toContain("actions/dependency-review-action@");
  });

  it("validates an exact published tag and migrations before deploying", () => {
    const source = workflow("deploy.yml");
    const nodeSetup = source.indexOf("Set up Node.js");
    const tagValidation = source.indexOf("validate-tag");
    const migrationGate = source.indexOf("check-migrations");
    const deploy = source.indexOf("wrangler deploy --env production");
    const smoke = source.indexOf("verify-deployment");

    expect(source).toContain("environment: production");
    expect(source).toContain("ref: main");
    expect(source).not.toContain("ref: ${{ inputs.tag }}");
    expect(source).toContain("releases/tags/$RELEASE_TAG");
    expect(source).toContain("pnpm config:check:production");
    expect(source).toContain(
      "wrangler d1 execute DB --remote --env production",
    );
    expect(nodeSetup).toBeGreaterThan(0);
    expect(tagValidation).toBeGreaterThan(nodeSetup);
    expect(migrationGate).toBeGreaterThan(tagValidation);
    expect(deploy).toBeGreaterThan(migrationGate);
    expect(smoke).toBeGreaterThan(deploy);
  });

  it("applies migrations only through a confirmed protected production job", () => {
    const source = workflow("migrate-production.yml");
    expect(source.indexOf("validate-tag")).toBeGreaterThan(
      source.indexOf("Set up Node.js"),
    );
    expect(source).toContain("environment: production");
    expect(source).toContain(
      'test "$DATABASE_CONFIRMATION" = "ludovico-tech-production"',
    );
    expect(source).toContain("validate-tag");
    expect(source).toContain("releases/tags/$RELEASE_TAG");
    expect(source).toContain("pnpm config:check:production");
    expect(source).toContain(
      "wrangler d1 migrations apply DB --remote --env production",
    );
    expect(source).toContain("check-migrations");
  });
});
