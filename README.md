# Ludovico Tech

## Background

Ludovico Tech is a shared movie watchlist for a group of friends with more
recommendations than movie nights. It grew from the group repeatedly asking one
friend, “You haven't seen that?!” into a long-running, RiffTrax-esque pop-culture
re-education program. The group maintains the list and randomly chooses what to
watch next to keep things fair and interesting. After each movie, that one friend
has to rate it with a contextual reference to check it off the list before another
can be chosen. The name is a tongue-in-cheek nod to the Ludovico Technique in _A
Clockwork Orange_. After all, while the group tries to make movie nights enjoyable
for everyone, that one friend _is_ still being forced to watch a lot of movies...

## Features

The application provides a shared movie catalog, random selection, and viewing
history. It uses movie and collection data from
[TMDB](https://www.themoviedb.org/) for quick reference, visual context, and
categorization. Anyone can browse, while allowlisted members sign in with Google to
make changes. See [product intent](docs/product.md) for more detail about the
application and how it functions.

## Tech stack

The TypeScript application combines a React and Vite client with a Hono API on
Cloudflare Workers. Cloudflare D1 stores the shared catalog and viewing state, while
Zod validates data at the application's boundaries. Vitest and Playwright cover the
unit, integration, component, and browser behavior.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release compatibility contract and
before opening a change. A selected legacy catalog can be loaded through the
optional [private import runbook](docs/private-import.md).

Never commit credentials, private catalog source data, or generated private
import artifacts.
