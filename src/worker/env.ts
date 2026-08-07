export type AppEnv = {
  Bindings: {
    DB: D1Database;
    ASSETS?: Fetcher;
    TMDB_READ_ACCESS_TOKEN?: string;
    APP_ENV?: string;
    AUTH_MODE?: string;
    APP_VERSION?: string;
    GIT_SHA?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI?: string;
    ALLOWED_EMAILS?: string;
  };
};

export type AppEnvironment = "development" | "production" | "test";
export type AuthMode = "development" | "google";

export type RuntimeConfig = {
  authMode: AuthMode;
  environment: AppEnvironment;
};

export class RuntimeConfigurationError extends Error {
  constructor() {
    super("Application runtime configuration is invalid");
    this.name = "RuntimeConfigurationError";
  }
}

export type Actor = {
  id: string;
  email: string;
  displayName: string;
};

export const getRuntimeConfig = (env: AppEnv["Bindings"]): RuntimeConfig => {
  const environment = env.APP_ENV;
  const authMode = env.AUTH_MODE;
  if (
    (environment !== "development" &&
      environment !== "test" &&
      environment !== "production") ||
    (authMode !== "development" && authMode !== "google") ||
    (environment === "production" && authMode !== "google")
  ) {
    throw new RuntimeConfigurationError();
  }
  return { authMode, environment };
};

export const isDevelopmentAuth = (env: AppEnv["Bindings"]) => {
  const config = getRuntimeConfig(env);
  return config.authMode === "development";
};

export const isProductionReady = (env: AppEnv["Bindings"]) => {
  const config = getRuntimeConfig(env);
  if (config.environment !== "production") return true;
  return Boolean(
    env.TMDB_READ_ACCESS_TOKEN &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI &&
    env.ALLOWED_EMAILS?.split(",").some((value) => value.trim()),
  );
};

export const now = () => new Date().toISOString();

export const newId = () => crypto.randomUUID();

export const normalizeTitle = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

export const createCodeVerifier = () =>
  base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const createState = () =>
  base64Url(crypto.getRandomValues(new Uint8Array(24)));

export const createSessionId = () =>
  base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
};

const getCookie = (request: Request, name: string) => {
  const cookies = request.headers.get("Cookie")?.split(";") ?? [];
  const match = cookies
    .map((cookie) => cookie.trim().split("="))
    .find(([key]) => key === name);
  return match?.[1] ?? null;
};

export const getActor = async (
  env: AppEnv["Bindings"],
  request: Request,
): Promise<Actor | null> => {
  if (isDevelopmentAuth(env)) {
    return {
      id: "local-developer",
      email: "local@example.test",
      displayName: "Local developer",
    };
  }

  const sessionId = getCookie(request, "movie_list_session");
  if (!sessionId) return null;
  const session = await env.DB.prepare(
    `SELECT users.id, users.email, users.display_name, auth_sessions.expires_at
     FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.id = ?`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      expires_at: string;
    }>();
  if (!session || session.expires_at <= now()) return null;
  return {
    id: session.id,
    email: session.email,
    displayName: session.display_name ?? session.email,
  };
};

export const sessionCookie = (
  value: string,
  production: boolean,
  maxAge = 60 * 60 * 24 * 30,
) =>
  `movie_list_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${production ? "; Secure" : ""}`;
