import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowDirectory = resolve(".github/workflows");
const workflow = (name: string) =>
  readFileSync(join(workflowDirectory, name), "utf8");

const workflowStep = (source: string, name: string) => {
  const start = source.indexOf(`      - name: ${name}`);
  const end = source.indexOf("\n      - name:", start + 1);

  expect(start).toBeGreaterThan(-1);
  return source.slice(start, end === -1 ? undefined : end);
};

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
  it("keeps expensive application checks behind conservative path classification", () => {
    const source = workflow("ci.yml");
    const fullVerificationSteps = [
      "Install Playwright browser",
      "Validate Cloudflare configuration isolation",
      "Lint",
      "Typecheck",
      "Run unit and integration tests with coverage",
      "Build staging assets",
      "Build production assets",
      "Build Family Bonding assets",
      "Run browser end-to-end tests",
      "Audit production dependencies",
      "Check production dependency licenses",
    ];

    expect(source).toContain("verify:");
    expect(workflowStep(source, "Classify changed paths")).toContain(
      "run: pnpm exec tsx scripts/ci-paths.ts",
    );
    for (const name of fullVerificationSteps) {
      expect(workflowStep(source, name)).toContain(
        "if: steps.changes.outputs.full == 'true'",
      );
    }
    expect(source).toContain("run: pnpm config:check");
    expect(source).toContain("run: pnpm test:coverage");
    expect(source).toContain("run: pnpm test:e2e");
    expect(source).toContain("run: pnpm audit:production");
    expect(source).toContain("run: pnpm licenses:check");
    expect(source).toContain("run: pnpm build:staging");
    expect(source).toContain("run: pnpm build:production");
    expect(source).toContain("run: pnpm build:production-family-bonding");
    expect(source).toContain("actions/dependency-review-action@");
    expect(source).toContain("Keep released migrations immutable");
    expect(source).toContain("--diff-filter=MDR");
    expect(source).toContain("add a new migration instead");
  });

  it("always checks formatting and validates changed Renovate configuration", () => {
    const source = workflow("ci.yml");
    const formatting = workflowStep(source, "Check formatting");
    const renovate = workflowStep(source, "Validate Renovate configuration");

    expect(formatting).toContain("run: pnpm format:check");
    expect(formatting).not.toContain("steps.changes.outputs.full");
    expect(renovate).toContain(
      "if: steps.changes.outputs.renovate_config == 'true'",
    );
    expect(renovate).toContain(
      "pnpm --package=renovate@44.39.0 dlx renovate-config-validator renovate.json",
    );
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

  it("uses the trusted audit classifier for exact-release deployments", () => {
    for (const name of [
      "deploy.yml",
      "deploy-staging.yml",
      "deploy-production-family-bonding.yml",
    ]) {
      const source = workflow(name);
      expect(
        workflowStep(source, "Preserve the trusted deployment gate"),
      ).toContain(
        'cp scripts/production-audit.ts "$RUNNER_TEMP/production-audit.ts"',
      );
      expect(workflowStep(source, "Audit production dependencies")).toContain(
        'run: node "$RUNNER_TEMP/production-audit.ts"',
      );
    }
  });

  it.each([
    {
      file: "deploy-staging.yml",
      target: "staging",
      label: "staging",
      baseUrl: "STAGING_BASE_URL",
    },
    {
      file: "deploy.yml",
      target: "production",
      label: "production",
      baseUrl: "PRODUCTION_BASE_URL",
    },
    {
      file: "deploy-production-family-bonding.yml",
      target: "production-family-bonding",
      label: "Family Bonding",
      baseUrl: "PRODUCTION_FAMILY_BONDING_BASE_URL",
    },
  ])(
    "authenticates every $target deployment check using the trusted verifier",
    ({ file, target, label, baseUrl }) => {
      const source = workflow(file);
      const preserve = workflowStep(
        source,
        "Preserve the trusted deployment gate",
      );
      const preserveIndex = source.indexOf(preserve);
      const checkoutIndex = source.indexOf("git checkout --detach");
      const installIndex = source.indexOf(
        "run: pnpm install --frozen-lockfile",
      );
      const gates = [
        {
          name: `Verify deployed ${label} maintenance mode`,
          phase: "maintenance",
          deployment: "Deploy exact release in maintenance mode",
          record: "maintenance-deployment.ndjson",
        },
        {
          name: "Verify deployed release health",
          phase: "active",
          deployment: "Deploy exact release commit",
          record: "active-deployment.ndjson",
        },
        {
          name: "Verify maintenance fallback",
          phase: "maintenance",
          deployment: "Restore maintenance mode after cutover failure",
          record: "fallback-deployment.ndjson",
        },
      ];

      expect(
        workflowStep(source, "Check out the trusted deployment gate"),
      ).toContain("ref: main");
      for (const script of [
        "release-gates.ts",
        "cloudflare-deployment.ts",
        "verify-cloudflare-deployment.ts",
      ]) {
        expect(preserve).toContain(
          `cp scripts/${script} "$RUNNER_TEMP/${script}"`,
        );
      }
      expect(preserveIndex).toBeLessThan(checkoutIndex);
      expect(checkoutIndex).toBeLessThan(installIndex);
      expect(
        source.match(/node "\$RUNNER_TEMP\/verify-cloudflare-deployment\.ts"/g),
      ).toHaveLength(gates.length);
      expect(source).not.toMatch(/\bverify-(?:maintenance|deployment)\b/);

      for (const { name, phase, deployment, record } of gates) {
        const gate = workflowStep(source, name);
        const deploy = workflowStep(source, deployment);
        expect(source.indexOf(gate)).toBeGreaterThan(installIndex);
        expect(source.indexOf(gate)).toBeGreaterThan(source.indexOf(deploy));
        expect(deploy).toContain(
          `WRANGLER_OUTPUT_FILE_PATH: \${{ runner.temp }}/${record}`,
        );
        expect(gate).toContain(
          "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
        );
        expect(gate).toContain(
          "CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
        );
        expect(gate).toContain('WRANGLER_SEND_METRICS: "false"');
        expect(gate).toContain(
          `node "$RUNNER_TEMP/verify-cloudflare-deployment.ts" ${phase} \\\n            "$${baseUrl}" "$RELEASE_TAG" "$RELEASE_SHA" ${target} \\\n            "$RUNNER_TEMP/${record}"`,
        );
      }

      expect(workflowStep(source, gates[0].name)).not.toContain("        if:");
      const active = workflowStep(source, gates[1].name);
      if (target === "production-family-bonding") {
        expect(active).toContain(
          "if: inputs.mode == 'activate' || inputs.mode == 'deploy'",
        );
      } else {
        expect(active).not.toContain("        if:");
      }
      expect(workflowStep(source, gates[2].name)).toContain(
        "if: ${{ failure() && steps.maintenance.outcome == 'success' }}",
      );
    },
  );

  it("cuts over exact staging releases behind verified maintenance mode", () => {
    const source = workflow("deploy-staging.yml");
    const nodeSetup = source.indexOf("Set up Node.js");
    const tagValidation = source.indexOf("validate-tag");
    const releaseCheckout = source.indexOf(
      'git checkout --detach "$RELEASE_SHA"',
    );
    const configGate = source.indexOf("pnpm config:check:staging");
    const build = source.indexOf("pnpm build:staging");
    const maintenanceDeploy = source.indexOf(
      "Deploy exact release in maintenance mode",
    );
    const maintenanceGate = source.indexOf(
      "Verify deployed staging maintenance mode",
    );
    const migration = source.indexOf("wrangler d1 migrations apply DB");
    const migrationGate = source.indexOf("check-migrations");
    const deploy = source.indexOf("Deploy exact release commit");
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
    expect(source).toContain(
      '--secrets-file "$RUNNER_TEMP/staging-secrets.json"',
    );
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
    expect(releaseCheckout).toBeGreaterThan(tagValidation);
    expect(build).toBeGreaterThan(configGate);
    expect(maintenanceDeploy).toBeGreaterThan(build);
    expect(maintenanceGate).toBeGreaterThan(maintenanceDeploy);
    expect(migration).toBeGreaterThan(releaseCheckout);
    expect(migration).toBeGreaterThan(maintenanceGate);
    expect(migrationGate).toBeGreaterThan(migration);
    expect(deploy).toBeGreaterThan(migrationGate);
    expect(smoke).toBeGreaterThan(deploy);
    expect(source).toContain('--var "MAINTENANCE_MODE:true"');
    expect(source).toContain('--var "MAINTENANCE_MODE:false"');
    expect(source).toContain("steps.maintenance.outcome == 'success'");
  });

  it("cuts over an exact release behind verified maintenance mode", () => {
    const source = workflow("deploy.yml");
    const nodeSetup = source.indexOf("Set up Node.js");
    const tagValidation = source.indexOf("validate-tag");
    const releaseCheckout = source.indexOf(
      'git checkout --detach "$release_sha"',
    );
    const build = source.indexOf("pnpm build:production");
    const maintenanceDeploy = source.indexOf(
      "Deploy exact release in maintenance mode",
    );
    const maintenanceGate = source.indexOf(
      "Verify deployed production maintenance mode",
    );
    const refreshIdleGate = source.indexOf(
      "Wait for production refresh activity to stop",
    );
    const recoveryCheckpoint = source.indexOf(
      "Capture production D1 recovery checkpoint",
    );
    const migration = source.indexOf("wrangler d1 migrations apply DB");
    const migrationGate = source.indexOf("check-migrations");
    const deploy = source.indexOf("Deploy exact release commit");
    const smoke = source.indexOf("Verify deployed release health");
    const fallback = source.indexOf(
      "Restore maintenance mode after cutover failure",
    );

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
    expect(source).toContain(
      '--secrets-file "$RUNNER_TEMP/production-secrets.json"',
    );
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
      /wrangler d1 migrations apply DB\s+--config wrangler\.jsonc --remote --env production/,
    );
    expect(source).toMatch(
      /wrangler d1 execute DB --config wrangler\.jsonc --remote --env production/,
    );
    expect(source).toContain("check-refresh-idle");
    expect(source).not.toContain("check-refresh-paused");
    expect(source).toContain("d1 time-travel info DB");
    expect(source).toContain("D1_RECOVERY_BOOKMARK");
    expect(source).toContain('--var "MAINTENANCE_MODE:true"');
    expect(source).toContain('--var "MAINTENANCE_MODE:false"');
    expect(source).toContain("steps.maintenance.outcome == 'success'");
    expect(nodeSetup).toBeGreaterThan(0);
    expect(tagValidation).toBeGreaterThan(nodeSetup);
    expect(releaseCheckout).toBeGreaterThan(tagValidation);
    expect(build).toBeGreaterThan(tagValidation);
    expect(maintenanceDeploy).toBeGreaterThan(build);
    expect(maintenanceGate).toBeGreaterThan(maintenanceDeploy);
    expect(refreshIdleGate).toBeGreaterThan(maintenanceGate);
    expect(recoveryCheckpoint).toBeGreaterThan(maintenanceGate);
    expect(recoveryCheckpoint).toBeGreaterThan(refreshIdleGate);
    expect(migration).toBeGreaterThan(releaseCheckout);
    expect(migration).toBeGreaterThan(recoveryCheckpoint);
    expect(migrationGate).toBeGreaterThan(migration);
    expect(deploy).toBeGreaterThan(migrationGate);
    expect(smoke).toBeGreaterThan(deploy);
    expect(fallback).toBeGreaterThan(smoke);
    expect(source).toContain(
      '"$PRODUCTION_BASE_URL" "$RELEASE_TAG" "$RELEASE_SHA" production',
    );
  });

  it("does not allow production migrations outside version deployment", () => {
    expect(readdirSync(workflowDirectory)).not.toContain(
      "migrate-production.yml",
    );
  });

  it("keeps Family Bonding in maintenance through its private initial import", () => {
    const source = workflow("deploy-production-family-bonding.yml");
    const maintenanceDeploy = source.indexOf(
      "Deploy exact release in maintenance mode",
    );
    const maintenanceGate = source.indexOf(
      "Verify deployed Family Bonding maintenance mode",
    );
    const migration = source.indexOf("wrangler d1 migrations apply DB");
    const emptyGate = source.indexOf("check-production-family-bonding-empty");
    const seedGate = source.indexOf("check-production-family-bonding-initial");
    const activateDeploy = source.indexOf("Deploy exact release commit");
    const smoke = source.indexOf("Verify deployed release health");

    expect(source).toContain("environment: production-family-bonding");
    expect(source).toContain(
      "options:\n          - prepare\n          - activate\n          - deploy",
    );
    expect(source).toContain("pnpm config:check:production-family-bonding");
    expect(source).toContain("pnpm build:production-family-bonding");
    expect(source).toContain(
      '"$PRODUCTION_FAMILY_BONDING_BASE_URL" "$RELEASE_TAG" "$RELEASE_SHA" production-family-bonding',
    );
    expect(source).toContain("--remote --env production-family-bonding");
    expect(source).toContain("check-refresh-disabled");
    expect(source).toContain("check-production-family-bonding-populated");
    expect(source).toContain("if: inputs.mode == 'prepare'");
    expect(source).toContain("if: inputs.mode == 'activate'");
    expect(source).toContain(
      "if: inputs.mode == 'activate' || inputs.mode == 'deploy'",
    );
    expect(source).not.toContain("import:catalog");
    expect(maintenanceDeploy).toBeGreaterThan(0);
    expect(maintenanceGate).toBeGreaterThan(maintenanceDeploy);
    expect(migration).toBeGreaterThan(maintenanceGate);
    expect(emptyGate).toBeGreaterThan(migration);
    expect(seedGate).toBeGreaterThan(emptyGate);
    expect(activateDeploy).toBeGreaterThan(seedGate);
    expect(smoke).toBeGreaterThan(activateDeploy);
  });
});
