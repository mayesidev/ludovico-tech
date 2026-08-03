# Movie List

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

Local secrets belong in `.env` and source data belongs under `/data`; neither is committed. The TMDB read token is only used by the Worker and must never be exposed to the browser.

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
