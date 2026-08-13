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

describe("complete CI and deployment gates", () => {
  it("keeps coverage, browser, audit, and license checks in the stable verify job", () => {
    const source = workflow("ci.yml");
    expect(source).toContain("verify:");
    expect(source).toContain("run: pnpm config:check");
    expect(source).toContain("run: pnpm test:coverage");
    expect(source).toContain("run: pnpm test:e2e");
    expect(source).toContain("run: pnpm audit:production");
    expect(source).toContain("run: pnpm licenses:check");
    expect(source).toContain("run: pnpm build:staging");
    expect(source).toContain("run: pnpm build:production");
    expect(source).toContain("actions/dependency-review-action@");
  });

  it("publishes versions after verified main without deploying them", () => {
    const source = workflow("release.yml");
    expect(source).toContain("workflow_run:");
    expect(source).toContain("workflows: [CI]");
    expect(source).toContain("branches: [main]");
    expect(source).toContain("workflow_run.conclusion == 'success'");
    expect(source).toContain("workflow_run.event == 'push'");
    expect(source).toContain("pnpm exec semantic-release");
    expect(source).not.toMatch(
      /wrangler|cloudflare|environment:\s+production/i,
    );
  });

  it("deploys exact releases to isolated staging only when provisioned", () => {
    const source = workflow("deploy-staging.yml");
    const nodeSetup = source.indexOf("Set up Node.js");
    const tagValidation = source.indexOf("validate-tag");
    const configGate = source.indexOf("pnpm config:check:staging");
    const build = source.indexOf("pnpm build:staging");
    const migration = source.indexOf("wrangler d1 migrations apply DB");
    const deploy = source.indexOf("wrangler deploy \\");
    const smoke = source.indexOf(
      '"$STAGING_BASE_URL" "$RELEASE_TAG" "$RELEASE_SHA" staging',
      deploy,
    );

    expect(source).toContain("workflows: [Release]");
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("vars.STAGING_DEPLOY_ENABLED == 'true'");
    expect(source).toContain("environment: staging");
    expect(source).toContain("ref: main");
    expect(source).toContain("pnpm config:check:staging");
    expect(source).toMatch(
      /wrangler d1 migrations apply DB\s+--config wrangler\.jsonc --remote --env staging/,
    );
    expect(source).toContain("pnpm build:staging");
    expect(source).toContain(
      '"$STAGING_BASE_URL" "$RELEASE_TAG" "$RELEASE_SHA" staging',
    );
    expect(source).toContain("Required staging secret %s is not configured");
    expect(source).toContain('--secrets-file "$secrets_file"');
    expect(source).toContain(
      "TMDB_READ_ACCESS_TOKEN: ${{ secrets.TMDB_READ_ACCESS_TOKEN }}",
    );
    expect(source).toContain(
      "GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}",
    );
    expect(source).not.toContain('--var "TMDB_READ_ACCESS_TOKEN:');
    expect(source).not.toContain('--var "GOOGLE_CLIENT_SECRET:');
    expect(source).toContain("releases/tags/$RELEASE_TAG");
    expect(source).toContain('test "$release_sha" = "$TRIGGER_SHA"');
    expect(nodeSetup).toBeGreaterThan(0);
    expect(tagValidation).toBeGreaterThan(nodeSetup);
    expect(configGate).toBeGreaterThan(tagValidation);
    expect(build).toBeGreaterThan(configGate);
    expect(migration).toBeGreaterThan(build);
    expect(deploy).toBeGreaterThan(migration);
    expect(smoke).toBeGreaterThan(deploy);
  });

  it("validates an exact published tag and migrations before deploying", () => {
    const source = workflow("deploy.yml");
    const nodeSetup = source.indexOf("Set up Node.js");
    const tagValidation = source.indexOf("validate-tag");
    const migrationGate = source.indexOf("check-migrations");
    const build = source.indexOf("pnpm build:production");
    const deploy = source.indexOf("wrangler deploy \\");
    const smoke = source.indexOf("verify-deployment");

    expect(source).toContain("environment: production");
    expect(source).toContain("ref: main");
    expect(source).not.toContain("ref: ${{ inputs.tag }}");
    expect(source).toContain("releases/tags/$RELEASE_TAG");
    expect(source).toContain("pnpm config:check:production");
    expect(source).toContain(
      '"$PRODUCTION_BASE_URL" "$RELEASE_TAG" "$RELEASE_SHA" production',
    );
    expect(source).toContain("Required production secret %s is not configured");
    expect(source).toContain("production-secrets.json");
    expect(source).toContain('--secrets-file "$secrets_file"');
    expect(source).toContain(
      "TMDB_READ_ACCESS_TOKEN: ${{ secrets.TMDB_READ_ACCESS_TOKEN }}",
    );
    expect(source).toContain(
      "GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}",
    );
    expect(source).toContain(
      "GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}",
    );
    expect(source).toContain(
      "GOOGLE_REDIRECT_URI: ${{ secrets.GOOGLE_REDIRECT_URI }}",
    );
    expect(source).toContain("ALLOWED_EMAILS: ${{ secrets.ALLOWED_EMAILS }}");
    expect(source).not.toContain('--var "TMDB_READ_ACCESS_TOKEN:');
    expect(source).not.toContain('--var "GOOGLE_CLIENT_SECRET:');
    expect(source).not.toContain(
      "CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN",
    );
    expect(source).not.toContain(
      "CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID",
    );
    expect(source).toContain("pnpm build:production");
    expect(source).toMatch(
      /wrangler d1 execute DB --config wrangler\.jsonc --remote --env production/,
    );
    expect(nodeSetup).toBeGreaterThan(0);
    expect(tagValidation).toBeGreaterThan(nodeSetup);
    expect(build).toBeGreaterThan(tagValidation);
    expect(migrationGate).toBeGreaterThan(build);
    expect(deploy).toBeGreaterThan(migrationGate);
    expect(smoke).toBeGreaterThan(deploy);
    expect(source).toContain(
      '"$PRODUCTION_BASE_URL" "$RELEASE_TAG" "$RELEASE_SHA" production',
    );
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
    expect(source).toMatch(
      /wrangler d1 migrations apply DB\s+--config wrangler\.jsonc --remote --env production/,
    );
    expect(source).toContain("check-migrations");
  });
});
