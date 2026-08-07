# Contributing

## Development workflow

Verify the reported problem against the current application and agreed acceptance
criteria before implementing it. Existing code, documentation, issue history,
identifiers, tests, and successful checks are useful evidence, but none of them is
automatic proof that the present behavior or plan is correct. Surface material
contradictions before they become implementation decisions.

Create a branch from the current `main` branch for each focused change. Begin with
a clean, understood worktree and inspect the complete branch diff before every
commit and pull request so unrelated local work is not included. Do not push
directly to `main`.

For substantial or multi-part changes, agree on the intended outcome, acceptance
criteria, sequence, and dependencies before implementation. Link the pull request
to its issue when one exists. Record independently useful discoveries separately
instead of expanding an active change merely because the adjacent work is
convenient.

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

Passing commands and aggregate coverage are regression evidence, not a definition
of correctness. Review the required behavior and direct evidence in
[`docs/test-strategy.md`](docs/test-strategy.md). Changed critical authorization,
data, state-transition, import, or delivery behavior needs a direct test even when
the aggregate thresholds already pass.

Tests must not call TMDB, Google, or other external APIs. Mock external responses
or use the local Worker/D1 harness.

## Code, commits, and pull requests

- Keep files organized by responsibility and format changes with Prettier.
- Add or update tests for behavior changes.
- Keep commits focused on one discrete concern.
- Keep each pull request to one coherent concern that can be explained, validated,
  released, and reverted as a unit. Separate general dependency, refactor,
  test-framework, coverage, build, CI, or process work from a product change unless
  it is required to validate or operate that change; explain the dependency when
  they must remain together.
- Use Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, and `chore:`. Semantic-release uses these messages to determine the
  next release version and generate release notes. CI validates both the pull
  request title and the commits in the pull request; the title should also be a
  valid Conventional Commit because it becomes the commit message when using
  squash merge.
- Never commit `.env`, `/data`, `/.agents`, credentials, or private source data.

Choose the Conventional Commit type by the effect of the change, not its apparent
size or file type. Non-release changes such as documentation, tests, and routine
chores do not normally produce a new version. A behavioral or operational fix
that must be consumed by an exact release should use an accurate release-producing
type; never combine an older tag with newer unversioned configuration.

GitHub-generated merge commits are ignored by Commitlint. All
contributor-authored commits and squash-merge titles must pass the Conventional
Commit rules. The CI workflow also enforces formatting, linting, typechecking,
unit/integration tests with coverage, the production build, browser E2E tests,
production dependency audit, and the reviewed production license set.

Before requesting review, confirm that:

- The pull request identifies the verified problem, intended behavior, and
  acceptance criteria.
- Included and explicitly excluded scope are clear, and the complete diff is
  limited to that concern.
- Tests cover changed behavior and do not make live API calls.
- `pnpm check`, `pnpm build`, and, when relevant, `pnpm test:e2e` pass locally.
- The pull request records relevant evidence rather than relying only on a green
  status or aggregate percentage.
- Migration, configuration, deployment, rollout, and rollback implications are
  explained, including an explicit statement when none apply.

A change is **contributor-ready** when its focused branch is pushed, its pull
request accurately describes the complete diff and evidence, required checks have
reached a passing terminal state, and review threads are resolved. It is
**maintainer-delivered** only after merge, successful default-branch validation,
and any applicable publication, migration, deployment, and smoke verification.

## Releases and deployment

Successful CI on `main` triggers semantic-release. When the merged commits require
a version, it creates the next version tag and GitHub Release from their
Conventional Commit messages. A successful release workflow with no new tag is an
expected outcome when the merged changes are not release-producing. Contributors
should not create release tags or GitHub Releases manually.

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

Maintainers monitor every applicable post-merge workflow to a terminal state and
verify that the published artifact or deployed environment contains the intended
change. Skipped, cancelled, failed, or intentionally deferred stages must be
reported as such rather than treated as successful delivery.
