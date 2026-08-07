# Contributing

## Development workflow

Create a branch from the current `main` branch for each focused change, then open a pull request. `main` is protected; changes are merged through pull requests after the required `CI / verify` check passes.

Keep pull requests small enough to review and describe the user-visible behavior, implementation notes, and verification performed. Do not push directly to `main`.

## Before opening a change

Use Node 24 (recorded in `.node-version`), install dependencies with the pinned
pnpm version from `package.json`, and run the local quality gate:

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
- Use Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:`. Semantic-release uses these messages to determine the next release version and generate release notes. CI validates both the pull request title and the commits in the pull request; the title should also be a valid Conventional Commit because it becomes the commit message when using squash merge.
- Never commit `.env`, `/data`, `/.agents`, credentials, or private source data.

GitHub-generated merge commits are ignored by Commitlint. All
contributor-authored commits and squash-merge titles must pass the Conventional
Commit rules. The CI workflow also enforces formatting, linting, typechecking,
unit/integration tests with coverage, the production build, browser E2E tests,
production dependency audit, and the reviewed production license set.

Before requesting review, confirm that:

- The change is limited to the intended concern.
- Tests cover changed behavior and do not make live API calls.
- `pnpm check`, `pnpm build`, and, when relevant, `pnpm test:e2e` pass locally.
- The pull request explains any migration, configuration, or deployment implications.

## Releases and deployment

Successful CI on `main` triggers semantic-release. It creates the next version tag and GitHub Release from Conventional Commit messages. Contributors should not create release tags or GitHub Releases manually.

When staging is provisioned and enabled, a successful Release workflow triggers
a separate exact-tag staging migration, deployment, and smoke run. A failed or
disabled staging deployment does not invalidate the published version. Real
Google/TMDB checks are deliberate human staging review, never ordinary CI.

Production deployment is a separate manual GitHub Actions workflow. It deploys
an exact published stable semantic-release tag only after every migration
required by that release is applied, then checks the deployed health version/SHA
and public catalog. Production secrets must remain in GitHub or Cloudflare
configuration; never add them to the repository.

Database migrations use their own manual, protected workflow with an exact
release tag and typed production-database confirmation. Production data imports
remain a separate explicitly reviewed operator action; neither operation is
hidden inside application deployment.
