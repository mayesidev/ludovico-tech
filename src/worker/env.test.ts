import { describe, expect, it } from "vitest";
import {
  getRuntimeConfig,
  isProductionReady,
  normalizeTitle,
  RuntimeConfigurationError,
  type AppEnv,
} from "./env";

describe("movie identity helpers", () => {
  it("normalizes titles for matching", () => {
    expect(normalizeTitle("The Wizard of Oz!")).toBe("the wizard of oz");
  });
});

describe("runtime configuration", () => {
  const bindings = (values: Partial<AppEnv["Bindings"]>) =>
    values as AppEnv["Bindings"];

  it("requires an explicit environment and authentication mode", () => {
    expect(() => getRuntimeConfig(bindings({}))).toThrow(
      RuntimeConfigurationError,
    );
    expect(() =>
      getRuntimeConfig(
        bindings({ APP_ENV: "production", AUTH_MODE: "development" }),
      ),
    ).toThrow(RuntimeConfigurationError);
  });

  it("allows explicit development authentication outside production", () => {
    expect(
      getRuntimeConfig(
        bindings({ APP_ENV: "development", AUTH_MODE: "development" }),
      ),
    ).toEqual({ environment: "development", authMode: "development" });
  });

  it("reports production readiness only when every integration is configured", () => {
    const base = bindings({ APP_ENV: "production", AUTH_MODE: "google" });
    expect(isProductionReady(base)).toBe(false);
    expect(
      isProductionReady({
        ...base,
        ALLOWED_EMAILS: "member@example.test",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REDIRECT_URI: "https://example.test/api/auth/google/callback",
        TMDB_READ_ACCESS_TOKEN: "tmdb-token",
      }),
    ).toBe(true);
  });
});
