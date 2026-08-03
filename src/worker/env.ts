export type AppEnv = {
  Bindings: {
    DB: D1Database;
    ASSETS?: Fetcher;
    TMDB_READ_ACCESS_TOKEN?: string;
    APP_ENV?: string;
  };
};

export type Actor = {
  id: string;
  email: string;
  displayName: string;
};

export const isLocal = (env: AppEnv["Bindings"]) => env.APP_ENV !== "production";

export const now = () => new Date().toISOString();

export const newId = () => crypto.randomUUID();

export const normalizeTitle = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const getActor = (env: AppEnv["Bindings"]): Actor | null => {
  if (isLocal(env)) {
    return { id: "local-developer", email: "local@example.test", displayName: "Local developer" };
  }

  return null;
};
