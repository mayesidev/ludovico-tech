# Ludovico Tech

A small shared movie watchlist for a friend group.

Product behavior, data boundaries, runtime environments, and delivery decisions
are recorded in [Product and architecture](docs/product-and-architecture.md).
The release evidence expected from automated validation is recorded in
[Test strategy](docs/test-strategy.md).

## Local development

```sh
pnpm install
pnpm exec wrangler d1 migrations apply ludovico-tech-development --local --env development
pnpm dev
```

The app runs at `http://localhost:5173`. The Worker API runs at `http://localhost:8787`.
An empty migrated database is a complete development environment; legacy data
import is an optional local operator workflow when a private source dataset is
available. See [Optional private catalog import](docs/private-import.md) for the
PII-safe positional sanitizer and deterministic local import process.

Copy `.dev.vars.development.example` to `.dev.vars.development` for optional
local Worker secrets. Keep unrelated development credentials out of this file.
Source data belongs under `/data`; neither source data nor local secret files are
committed. The TMDB read token is only used by the Worker and must never be
exposed to the browser.

The committed example contains variable names only. Never replace its empty
value with a credential in a tracked file. Production Google, TMDB, and invite
configuration belongs in Cloudflare secret storage, not a project `.env` file.

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
release_version="$(git describe --tags --exact-match --match 'v*' HEAD)"
git_sha="$(git rev-parse HEAD)"
pnpm exec wrangler deploy --env production \
  --var "APP_VERSION:${release_version}" \
  --var "GIT_SHA:${git_sha}"
```

Production deployments must come from an exact semantic-release tag. The `/api/health` response reports the deployed release version and commit SHA.

The `Deploy` GitHub Actions workflow accepts a published `vX.Y.Z` tag, checks out that exact tag, and deploys it to the production Wrangler environment. It requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the protected GitHub `production` environment. Database migrations remain a separate, explicitly reviewed operation.

Apply remote migrations explicitly and review the target before running them:

```sh
pnpm config:check:production
pnpm exec wrangler d1 migrations apply ludovico-tech-production --remote --env production
```

The checked-in production D1 ID is a non-deployable sentinel until the dedicated
`ludovico-tech-production` database is provisioned. Replace it with that new
database's ID during the protected production configuration task; never reuse a
development or unrelated application's database ID.

The optional source spreadsheet, sanitized intermediate data, and generated
import SQL remain local under `/data`. They are not required to bootstrap the
application and must not be uploaded or committed.

## Checks

```sh
pnpm check
pnpm build
```

`pnpm check` runs formatting, ESLint, TypeScript, and unit/integration tests. The same checks, production build, and browser E2E suite run in GitHub Actions for pushes and pull requests.

The test suite includes helper tests plus Worker-route integration tests running in Cloudflare's local Workers runtime with an isolated D1 database and the checked-in migrations.

Releases are created from protected `main` after the CI workflow succeeds. Semantic-release analyzes Conventional Commit messages, creates `vX.Y.Z` tags, and publishes GitHub Releases with generated notes. The initial release baseline is `v0.1.0`.

Browser end-to-end tests use Playwright against a separate local Vite instance and a fresh temporary D1 database:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright harness is intentionally isolated from the normal development ports and local database state. It does not call TMDB; the browser flow covers the shared add, roll, and rating experience.

## Public repository notes

The application display name and final domain are still configuration decisions. Update the Google OAuth redirect URI, Wrangler secrets, and public-facing copy together when those decisions are finalized.

Do not include `.env`, `/data`, `/.agents`, local database files, generated imports, or credentials in commits or issue reports.
