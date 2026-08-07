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
value with a credential in a tracked file. Deployed Google, TMDB, and invite
configuration belongs in Cloudflare secret storage, not a project `.env` file.

## Staging

Staging is a production-like, Google-authenticated Worker with a dedicated D1
database and runtime secrets. Its stable initial origin is
`https://ludovico-tech-staging.mayesidev.workers.dev`; it never shares a Worker,
database, or OAuth secret with production.

The `Deploy Staging` workflow resolves an exact stable GitHub Release, applies
that release's migrations to staging, deploys the exact tag commit, and verifies
the reported staging version/SHA plus public catalog. Successful Release workflow
runs trigger it automatically only when the repository variable
`STAGING_DEPLOY_ENABLED` is `true`; a manual exact-tag dispatch remains available
for initial provisioning and recovery.

The GitHub `staging` environment requires `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets plus the HTTPS-origin `STAGING_BASE_URL` variable.
The staging Worker separately requires its own TMDB token, Google web-client
values, exact callback URI, and invite allowlist in Cloudflare secret storage.
Automated validation never calls those providers; real integration checks are
deliberate staging review actions.

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

Production deployments must run through the protected GitHub workflow from an
exact semantic-release tag; do not bypass its approval and verification gates
with a workstation deployment. The `/api/health` response reports the deployed
release version and commit SHA.

The `Deploy` GitHub Actions workflow accepts an exact published stable `vX.Y.Z`
tag, checks out its tag commit, and deploys it through the protected GitHub
`production` environment. It refuses a draft/prerelease, invalid tag, missing
required release migration, non-ready runtime, or health tag/SHA mismatch. It
also smoke-checks the public catalog after deployment.

The protected GitHub environment requires `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets plus an HTTPS-origin
`PRODUCTION_BASE_URL` environment variable. Keep required-reviewer protection on
both the `Migrate Production` and `Deploy` workflows.

Apply remote migrations separately with the manual `Migrate Production`
workflow. It requires a published release tag and the exact typed confirmation
`ludovico-tech-production`, then runs against the protected production
environment. Deployment remains blocked until remote `d1_migrations` contains
every migration required by the selected release. Later forward migrations are
allowed so an expand/contract-compatible prior release can be redeployed.

For local read-only diagnosis, review the target and list migration state:

```sh
pnpm config:check:production
pnpm exec wrangler d1 migrations list DB --remote --env production
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

`pnpm check` runs configuration validation, formatting, ESLint, TypeScript, and
unit/integration tests with repository-wide coverage thresholds. The same checks,
production build, browser E2E suite, production dependency audit, and production
license allowlist run in GitHub Actions for pushes and pull requests.

The production dependency gates can also be run locally:

```sh
pnpm audit:production
pnpm licenses:check
```

The test suite includes helper tests plus Worker-route integration tests running in Cloudflare's local Workers runtime with an isolated D1 database and the checked-in migrations.

Successful CI on protected `main` triggers semantic-release. It analyzes
Conventional Commit messages, creates `vX.Y.Z` tags, and publishes GitHub
Releases with generated notes. Version publication is independent of deployment:
a release can exist before staging or production is provisioned. Provisioned
staging may consume it in a separate automatic workflow; production never deploys
merely because a release was published.

Browser end-to-end tests use Playwright against a separate local Vite instance and a fresh temporary D1 database:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright harness is intentionally isolated from the normal development ports and local database state. It does not call TMDB; the browser flow covers the shared add, roll, and rating experience.

## Public repository notes

The application display name and final domain are still configuration decisions. Update the Google OAuth redirect URI, Wrangler secrets, and public-facing copy together when those decisions are finalized.

Do not include `.env`, `/data`, `/.agents`, local database files, generated imports, or credentials in commits or issue reports.
