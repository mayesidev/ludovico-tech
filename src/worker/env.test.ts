import { describe, expect, it } from "vitest";
import {
  getRuntimeConfig,
  isDeploymentReady,
  isMaintenanceMode,
  isSecureEnvironment,
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
      getRuntimeConfig(bindings({ APP_ENV: "test", AUTH_MODE: "local" })),
    ).toThrow(RuntimeConfigurationError);
    expect(() =>
      getRuntimeConfig(
        bindings({ APP_ENV: "production", AUTH_MODE: "development" }),
      ),
    ).toThrow(RuntimeConfigurationError);
    expect(() =>
      getRuntimeConfig(
        bindings({ APP_ENV: "staging", AUTH_MODE: "development" }),
      ),
    ).toThrow(RuntimeConfigurationError);
    expect(() =>
      getRuntimeConfig(bindings({ APP_ENV: "test", AUTH_MODE: "google" })),
    ).toThrow(RuntimeConfigurationError);
  });

  it("allows explicit development authentication outside production", () => {
    expect(
      getRuntimeConfig(
        bindings({ APP_ENV: "development", AUTH_MODE: "development" }),
      ),
    ).toEqual({ environment: "development", authMode: "development" });
  });

  it("requires Google authentication in staging and production", () => {
    for (const environment of ["staging", "production"] as const) {
      expect(
        getRuntimeConfig(
          bindings({ APP_ENV: environment, AUTH_MODE: "google" }),
        ),
      ).toEqual({ environment, authMode: "google" });
      expect(isSecureEnvironment(environment)).toBe(true);
    }
    expect(isSecureEnvironment("development")).toBe(false);
    expect(isSecureEnvironment("test")).toBe(false);
  });

  it("reports deployed readiness only when every integration is configured", () => {
    const completeValues = {
      ALLOWED_EMAILS: "member@example.test",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REDIRECT_URI: "https://example.test/api/auth/google/callback",
      TMDB_READ_ACCESS_TOKEN: "tmdb-token",
    };
    for (const environment of ["staging", "production"] as const) {
      const base = bindings({ APP_ENV: environment, AUTH_MODE: "google" });
      const complete = { ...base, ...completeValues };
      expect(isDeploymentReady(base)).toBe(false);
      expect(isDeploymentReady(complete)).toBe(true);
      for (const key of [
        "ALLOWED_EMAILS",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI",
        "TMDB_READ_ACCESS_TOKEN",
      ] as const) {
        expect(isDeploymentReady({ ...complete, [key]: undefined })).toBe(
          false,
        );
      }
    }
  });

  it("requires an explicit boolean string for maintenance mode", () => {
    expect(isMaintenanceMode(bindings({}))).toBe(false);
    expect(isMaintenanceMode(bindings({ MAINTENANCE_MODE: "false" }))).toBe(
      false,
    );
    expect(isMaintenanceMode(bindings({ MAINTENANCE_MODE: "true" }))).toBe(
      true,
    );
    expect(() =>
      isMaintenanceMode(bindings({ MAINTENANCE_MODE: "yes" })),
    ).toThrow(RuntimeConfigurationError);
  });
});
