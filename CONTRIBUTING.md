# Contributing

## Before opening a change

Install dependencies with the pinned package manager and run the local quality gate:

```sh
pnpm install
pnpm check
pnpm build
```

For browser-flow changes, install Chromium once and run the isolated E2E suite:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Tests must not call TMDB, Google, or other external APIs. Mock external responses or use the local Worker/D1 harness.

## Code and commits

- Keep files organized by responsibility and format changes with Prettier.
- Add or update tests for behavior changes.
- Keep commits focused on one discrete concern.
- Never commit `.env`, `/data`, `/.agents`, credentials, or private source data.
