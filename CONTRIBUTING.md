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

## Safety

Never commit credentials, private source data, generated imports, local databases,
`.env`, `/data`, or `/.agents`. Private imports require an explicitly reviewed
operation. Protected deployments apply and verify the exact migration set from
the published release before deploying its application code, so migrations must
remain compatible with the prior deployed version if a later deployment step
fails. Released migration files are immutable; add a new numbered migration to
change an existing schema.
