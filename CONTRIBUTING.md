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

## Commits and delivery

Use Conventional Commit messages. The pull-request title must also be valid
because squash merge uses it as the default-branch commit. Choose the type by the
effect of the change: `feat` and `fix` normally produce releases, while changes
such as `docs`, `test`, `refactor`, and `chore` normally do not.

`main` is protected by `CI / verify`. After merge, maintainers verify every
applicable release or deployment workflow to a terminal state. The workflows and
their tests—not this document—define the delivery mechanics.

Renovate PRs receive manual review and merge. If a reviewed PR is behind `main`,
check its rebase/retry box and wait for Renovate's updated branch and fresh CI
before merging. Renovate continues to rebase branches with conflicts automatically.

Deployment verification uses authenticated Cloudflare service bindings to run the
deployed health and library checks. Cloudflare API checks also confirm the custom
domain mapping and that the exact uploaded version receives all traffic. This
verifies deployment configuration and application behavior, including maintenance
before migrations; it does not test public DNS, TLS, or edge security behavior.
The verifier keeps SDK output private and reports only fixed diagnostic messages.
