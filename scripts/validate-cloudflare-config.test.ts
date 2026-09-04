import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_DATABASE_ID_SENTINELS,
  parseWranglerConfig,
  validateCloudflareConfig,
  validateCloudflareConfigSource,
  type DeploymentTarget,
  type WorkerEnvironment,
  type WranglerConfig,
} from "./validate-cloudflare-config-lib";

const repositorySource = readFileSync(resolve("wrangler.jsonc"), "utf8");

const repositoryConfig = () => parseWranglerConfig(repositorySource);

const environment = (
  config: WranglerConfig,
  key: "development" | DeploymentTarget,
): WorkerEnvironment => {
  const value = config.env?.[key];
  if (!value) throw new Error(`Test fixture is missing ${key}`);
  return value;
};

const database = (
  config: WranglerConfig,
  key: "development" | DeploymentTarget,
) => {
  const value = environment(config, key).d1_databases?.[0];
  if (!value) throw new Error(`Test fixture is missing the ${key} database`);
  return value;
};

describe("Cloudflare environment isolation validation", () => {
  it("accepts the repository configuration while unresolved targets stay non-deployable", () => {
    expect(() =>
      validateCloudflareConfig(
        repositoryConfig(),
        new Set(["staging", "production"]),
      ),
    ).not.toThrow();
  });

  it("rejects a Worker name that could deploy to the wrong script", () => {
    const config = repositoryConfig();
    environment(config, "staging").name = "ludovico-tech-production";

    expect(() => validateCloudflareConfig(config)).toThrow(
      "staging Worker name must be ludovico-tech-staging",
    );
  });

  it("rejects a custom domain that belongs to another environment", () => {
    const config = repositoryConfig();
    environment(config, "staging").routes = [
      { custom_domain: true, pattern: "ludovicotech.com" },
    ];

    expect(() => validateCloudflareConfig(config)).toThrow(
      "staging custom domain is incorrect",
    );
  });

  it("requires the bounded TMDB refresh schedule in deployed environments", () => {
    const config = repositoryConfig();
    environment(config, "production").triggers = { crons: [] };

    expect(() => validateCloudflareConfig(config)).toThrow(
      "production TMDB refresh schedule is incorrect",
    );
  });

  it("requires the bounded Family Bonding refresh schedule", () => {
    const config = repositoryConfig();
    expect(
      environment(config, "production-family-bonding").triggers?.crons,
    ).toEqual(["*/15 * * * *"]);

    environment(config, "production-family-bonding").triggers = {
      crons: [],
    };
    expect(() => validateCloudflareConfig(config)).toThrow(
      "production-family-bonding TMDB refresh schedule is incorrect",
    );
  });

  it("keeps the Family Bonding target in the production runtime security class", () => {
    const config = repositoryConfig();
    expect(environment(config, "production-family-bonding").vars).toMatchObject(
      {
        APP_ENV: "production",
        AUTH_MODE: "google",
      },
    );

    environment(config, "production-family-bonding").vars = {
      APP_ENV: "production-family-bonding",
      AUTH_MODE: "google",
    };
    expect(() => validateCloudflareConfig(config)).toThrow(
      "production-family-bonding runtime variables are not fail-closed",
    );
  });

  it("rejects a D1 database shared by staging and production", () => {
    const config = repositoryConfig();
    database(config, "staging").database_id = database(
      config,
      "production",
    ).database_id;

    expect(() => validateCloudflareConfig(config)).toThrow(
      "Development and every deployment target must use distinct D1 IDs",
    );
  });

  it("rejects secret-like values declared as public Worker variables", () => {
    const config = repositoryConfig();
    environment(config, "development").vars = {
      APP_ENV: "development",
      AUTH_MODE: "development",
      GOOGLE_CLIENT_SECRET: "not-a-real-secret",
    };

    expect(() => validateCloudflareConfig(config)).toThrow(
      "development contains secret-like values in public vars",
    );
  });

  it("rejects invalid JSONC before inspecting environment values", () => {
    expect(() => validateCloudflareConfigSource('{ "name":')).toThrow(
      /wrangler\.jsonc is invalid JSONC/,
    );
  });

  for (const target of [
    "staging",
    "production",
    "production-family-bonding",
  ] as const) {
    it(`rejects an unresolved ${target} database sentinel only when deploying that target`, () => {
      const config = repositoryConfig();
      database(config, target).database_id =
        DEPLOYMENT_DATABASE_ID_SENTINELS[target];

      expect(() => validateCloudflareConfig(config)).not.toThrow();
      expect(() => validateCloudflareConfig(config, new Set([target]))).toThrow(
        `${target === "staging" ? "Staging" : target === "production" ? "Production" : "Family Bonding"} D1 is not provisioned`,
      );
    });
  }
});
