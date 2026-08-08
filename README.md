# Ludovico Tech

A shared movie watchlist for a small invited group. See [product intent](docs/product.md)
for the few decisions that are not apparent from the application and its tests.

## Develop

Use Node 24 and the pnpm version declared in `package.json`:

```sh
pnpm install
pnpm exec wrangler d1 migrations apply ludovico-tech-development --local --env development
pnpm dev
```

The browser app runs at `http://localhost:5173` and proxies `/api` to the Worker
at `http://localhost:8787`. A migrated empty database is a complete development
environment.

For optional local provider access, copy `.dev.vars.development.example` to
`.dev.vars.development` and add only the requested values. Local secrets and
source data remain untracked.

## Verify

```sh
pnpm check
pnpm build
```

For browser changes:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. A selected legacy
catalog can be loaded through the optional [private import runbook](docs/private-import.md).

Never commit local secret files, `.env`, `/data`, `/.agents`, local databases,
credentials, or generated private imports.
