# Contributing

## Development workflow

Create a branch from the current `main` branch for each focused change, then open a pull request. `main` is protected; changes are merged through pull requests after the required `CI / verify` check passes.

Keep pull requests small enough to review and describe the user-visible behavior, implementation notes, and verification performed. Do not push directly to `main`.

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

## Code, commits, and pull requests

- Keep files organized by responsibility and format changes with Prettier.
- Add or update tests for behavior changes.
- Keep commits focused on one discrete concern.
- Use Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:`. Semantic-release uses these messages to determine the next release version and generate release notes.
- Never commit `.env`, `/data`, `/.agents`, credentials, or private source data.

Conventional Commit messages are currently a repository convention, not a separately enforced CI check. The CI workflow enforces formatting, linting, typechecking, unit/integration tests, the production build, and browser E2E tests. A future commit-message check can be added if strict enforcement becomes useful.

Before requesting review, confirm that:

- The change is limited to the intended concern.
- Tests cover changed behavior and do not make live API calls.
- `pnpm check`, `pnpm build`, and, when relevant, `pnpm test:e2e` pass locally.
- The pull request explains any migration, configuration, or deployment implications.

## Releases and deployment

Successful CI on `main` triggers semantic-release. It creates the next version tag and GitHub Release from Conventional Commit messages. Contributors should not create release tags or GitHub Releases manually.

Production deployment is a separate manual GitHub Actions workflow. It deploys an exact published semantic-release tag and records that version and commit in the application health response. Production secrets must remain in GitHub or Cloudflare configuration; never add them to the repository.

Database migrations and production data imports are separate, explicitly reviewed operations and must not be hidden inside an application deployment.
