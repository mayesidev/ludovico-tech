# Ludovico Tech

A small shared movie watchlist for a friend group.

## Local development

```sh
pnpm install
pnpm exec wrangler d1 migrations apply movie-list --local
pnpm import:sheet -- "data/Movie List (Responses) - Form Responses 1.csv"
for file in data/generated-import-*.sql; do pnpm exec wrangler d1 execute movie-list --local --file="$file"; done
pnpm dev
```

The app runs at `http://localhost:5173`. The Worker API runs at `http://localhost:8787`.

Copy `.env.example` to `.env` for local configuration. Local secrets belong in `.env` and source data belongs under `/data`; neither is committed. The TMDB read token is only used by the Worker and must never be exposed to the browser.

The committed `.env.example` contains variable names and local-safe defaults only. Never replace its empty values with credentials or invite addresses.

## Production configuration

Production values are configured as Wrangler secrets, not committed files:

```sh
pnpm exec wrangler secret put TMDB_READ_ACCESS_TOKEN --env production
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
pnpm exec wrangler secret put GOOGLE_REDIRECT_URI --env production
pnpm exec wrangler secret put ALLOWED_EMAILS --env production
```

The Google OAuth redirect URI must match the production domain and the Google Cloud configuration. The invite list should contain only the addresses authorized to make changes.

Always select the Wrangler environment explicitly. Do not run an unqualified production deployment:

```sh
pnpm build
pnpm exec wrangler deploy --env production
```

Apply remote migrations explicitly and review the target before running them:

```sh
pnpm exec wrangler d1 migrations apply movie-list --remote --env production
```

The source spreadsheet and generated import SQL remain local under `/data`. They are not part of the public repository and must not be uploaded or committed.

## Checks

```sh
pnpm check
pnpm build
```

`pnpm check` runs formatting, ESLint, TypeScript, and unit/integration tests. The same checks, production build, and browser E2E suite run in GitHub Actions for pushes and pull requests.

The test suite includes helper tests plus Worker-route integration tests running in Cloudflare's local Workers runtime with an isolated D1 database and the checked-in migrations.

Browser end-to-end tests use Playwright against a separate local Vite instance and a fresh temporary D1 database:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright harness is intentionally isolated from the normal development ports and local database state. It does not call TMDB; the browser flow covers the shared add, roll, and rating experience.

## Public repository notes

The application display name and final domain are still configuration decisions. Update the Google OAuth redirect URI, Wrangler secrets, and public-facing copy together when those decisions are finalized.

Do not include `.env`, `/data`, `/.agents`, local database files, generated imports, or credentials in commits or issue reports.
