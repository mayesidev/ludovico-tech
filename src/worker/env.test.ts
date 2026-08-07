import { describe, expect, it } from "vitest";
import {
  getRuntimeConfig,
  isProductionReady,
  normalizeTitle,
  RuntimeConfigurationError,
  sessionCookie,
  sessionIdFromRequest,
  type AppEnv,
} from "./env";

describe("movie identity helpers", () => {
  it("normalizes titles for matching", () => {
    expect(normalizeTitle("The Wizard of Oz!")).toBe("the wizard of oz");
  });
});

describe("session cookie namespace", () => {
  it("reads and writes only the Ludovico Tech session cookie", () => {
    const request = new Request("https://example.test", {
      headers: {
        Cookie: "unrelated=value; ludovico_tech_session=current-session",
      },
    });

    expect(sessionIdFromRequest(request)).toBe("current-session");
    expect(sessionCookie("current-session", false)).toBe(
      "ludovico_tech_session=current-session; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000",
    );
    expect(sessionCookie("", true, 0)).toBe(
      "ludovico_tech_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure",
    );
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
      getRuntimeConfig(bindings({ APP_ENV: "staging", AUTH_MODE: "google" })),
    ).toThrow(RuntimeConfigurationError);
    expect(() =>
      getRuntimeConfig(bindings({ APP_ENV: "test", AUTH_MODE: "local" })),
    ).toThrow(RuntimeConfigurationError);
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
    const complete = {
      ...base,
      ALLOWED_EMAILS: "member@example.test",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REDIRECT_URI: "https://example.test/api/auth/google/callback",
      TMDB_READ_ACCESS_TOKEN: "tmdb-token",
    };
    expect(isProductionReady(base)).toBe(false);
    expect(isProductionReady(complete)).toBe(true);
    for (const key of [
      "ALLOWED_EMAILS",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "TMDB_READ_ACCESS_TOKEN",
    ] as const) {
      expect(isProductionReady({ ...complete, [key]: undefined })).toBe(false);
    }
  });
});
