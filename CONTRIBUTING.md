# Contributing

## Changes

Verify the problem and intended outcome before implementing it. Existing code,
documentation, history, and passing checks are evidence, not substitutes for
current acceptance criteria.

Start each coherent change from current `main` with a clean, understood worktree.
Keep unrelated discoveries separate, inspect the complete diff, and open a pull
request rather than pushing directly to `main`. The pull-request template records
scope, evidence, and delivery impact without requiring a separate narrative.

Tests should describe observable behavior and make the required functionality
clear. Add or update the narrowest useful scenario when behavior changes; do not
call live external services from automated tests.

Schema changes must add a new numbered migration. Released migrations are
immutable, and migrations must remain compatible with the currently deployed
application until the new release finishes deploying.

## Checks

```sh
pnpm install
pnpm check
pnpm build
```

Run `pnpm test:e2e` for browser workflows. Required CI remains the terminal
integration gate.

## Versions and compatibility

Releases follow Semantic Versioning across both application behavior and the
supported deployment contract. A change that makes a previously supported
application integration, database migration history, or deployment invocation
incompatible must be marked as breaking and produce a new major version.

Deployments apply the selected release's numbered migrations in order, then
require the D1 migration history to exactly match the files in that release.
Missing release migrations are applied automatically. Renamed, reordered, or
additional migration records are incompatible with that release, and the
deployment stops before publishing its application code.

## Commits and delivery

Use Conventional Commit messages. The pull-request title must also be valid
because squash merge uses it as the default-branch commit. Choose the type by the
effect of the change: `feat` and `fix` normally produce releases, while changes
such as `docs`, `test`, `refactor`, and `chore` normally do not. Mark breaking
changes with `!` and a `BREAKING CHANGE:` footer so the release receives a new
major version.

`main` is protected by `CI / verify`. After merge, maintainers verify every
applicable release or deployment workflow to a terminal state. The workflows and
their tests—not this document—define the delivery mechanics.
