declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  }

  interface GlobalProps {
    mainModule: typeof import("./worker/index");
  }
}
