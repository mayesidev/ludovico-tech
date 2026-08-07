# Product and architecture

This document is the durable source of truth for product behavior and technical
boundaries. Historical tickets and source spreadsheets provide context, but do
not override decisions recorded here.

## Product intent

Ludovico Tech is a small shared movie watchlist for an invited group.

The system being replaced is a Google Form backed by a Google Sheet. Form
submissions add candidate movies, and group members manually add ratings to the
Sheet after watching them. The exported Sheet is therefore both the legacy intake
record and the current watched-state store.

- Anyone may browse the catalog, the shared Now Showing state, and viewing
  history.
- Only an authenticated, allowlisted member may add or edit movies, change
  franchise order, roll or advance the shared selection, or record a rating.
- There is one shared Now Showing state for the group.
- A movie is eligible for selection until the group records its rating. Rating
  existence is the authoritative watched-state signal; there is no independent
  legacy watched flag, skipped state, or skip history.
- A movie has exactly one rating shared by the group. It contains a score from 0
  through 5 in half-point increments and a required custom rating phrase, which
  is the application's equivalent of a conventional star label.
- A named franchise is an optional grouping applied to a subset of movies.
  Franchise membership and order are application data, not metadata inferred
  automatically from an external provider.

### Selection and franchise behavior

- Every unwatched movie is an independently eligible entry in a random roll.
- When the rolled movie belongs to a franchise, Now Showing queues the first
  unwatched member of that franchise rather than necessarily queueing the exact
  movie that triggered the roll.
- Members determine and persist franchise order. TMDB may provide an initial
  suggestion when suitable metadata is available, but it is never authoritative.
- After rating a franchise movie, members may either continue with the next
  unwatched franchise member or perform a new random roll across all unwatched
  movies.
- A new random roll is not available while the current Now Showing movie remains
  unrated.

## External metadata

TMDB is the application's metadata provider. Search, identity confirmation,
release dates, posters, freshness checks, and user-facing external links use the
TMDB API through the Worker. Browser code never receives a TMDB credential and
does not call TMDB directly.

Legacy IMDb URLs exist only as private import references. The importer may use a
valid IMDb title identifier to reconcile duplicate source submissions, but the
application does not call or depend on an IMDb API. A controlled reconciliation
step confirms each imported movie against TMDB before attaching a TMDB identity.

TMDB attribution must follow its current branding and notice requirements.
The durable OAuth, session, server-side metadata, caching, error-mapping, and
attribution rules are recorded in
[Authentication and metadata service contract](external-services.md).

## Private source data

The application, migrations, local development environment, automated tests, and
production deployment must all work with an empty catalog. A legacy source
artifact is never a bootstrap dependency. Import is an optional local operator
workflow used only when a source dataset is available and selected for loading.

The original spreadsheet, sanitized intermediate data, generated SQL, validation
reports, and local environment files remain ignored and must never be committed
or uploaded as CI artifacts. Sanitizing headings does not by itself establish
that all row values are suitable for publication.

The first import stage ignores the original header text, maps fields by position
and purpose, and emits a generalized intermediate schema with fixed public-safe
field names. The deterministic database importer consumes only that generalized
format. Public code does not contain or propagate private column headings.

Import behavior is deterministic and strict:

- Every source submission receives a stable private provenance key.
- A valid legacy IMDb title identifier is used for initial deduplication;
  otherwise a stable source identity keeps same-title works distinct.
- A franchise name defines membership. Disagreement with the legacy franchise
  indicator is reported for review.
- The legacy prior-viewing response is retained as provenance and does not mark
  a movie watched by the group.
- A parseable manually entered legacy group rating marks the movie watched and
  creates its completed rating. The Form submission timestamp remains the movie's
  added date; it must not be presented as the watch date, which is unknown.
- Invalid ratings and conflicting canonical data stop a strict import. Other
  questionable references produce a private diagnostic that identifies only the
  source row and error code.
- Re-running the same validated import does not duplicate catalog data.
- Automated tests use synthetic generalized fixtures and never require or read
  the private source artifact.
- TMDB reconciliation is an optional cached and resumable follow-up stage. It
  does not run during sanitization, normal bootstrap, or automated tests.

Because the application has not reached its first production release, the
database may be reset and rebuilt from the source. After the first release,
schema changes use forward migrations and preserve production data.

## Runtime environments

### Local development

Local development runs Vite and Wrangler separately. Vite serves the browser
application and proxies `/api` to a local Worker. Wrangler uses a persistent local
D1 directory and never connects to production unless an operator supplies both
`--remote` and `--env production` explicitly.

Applying the checked-in migrations produces a complete empty application. An
operator may run the private sanitization and import workflow afterward, but
ordinary development does not depend on the source dataset.

Development authentication is an explicit configuration mode. Missing or
unknown environment configuration fails closed and must never create a developer
actor implicitly.

### Automated tests

Tests use isolated temporary state:

- Node tests validate import and other build-time tooling.
- Browser-like component tests validate authorization-aware presentation and
  user behavior.
- Worker integration tests run checked-in migrations against isolated D1 and
  fake all external services.
- Playwright validates representative user workflows without sharing normal
  development ports or data.

Coverage thresholds are a regression guard, not the definition of correctness.
The required behavior matrix and critical state transitions must have explicit
tests even when aggregate coverage is already above threshold.

### Production

Production is one Cloudflare Worker serving the built static application and the
Hono API, with a production D1 binding and Google OAuth secrets. Authentication
is always enforced for mutations and TMDB lookup. Production has no development
bypass or fallback actor.

## Delivery model

1. Pull requests run formatting, linting, typechecking, unit/component tests,
   Worker integration tests, migration/import tests, a production build, browser
   end-to-end tests, dependency vulnerability and license checks, and coverage
   thresholds.
2. Protected `main` accepts only changes that pass the complete CI gate.
3. Semantic release creates a version tag and published GitHub Release from a
   verified `main` commit. Publication is independent of environment readiness
   and does not mutate Cloudflare resources.
4. A separately reviewed production migration workflow applies pending D1
   migrations through the protected GitHub `production` environment.
5. Production deployment accepts only an exact published version tag, repeats
   the deterministic release gate from the frozen lockfile, verifies that every
   D1 migration required by that release is applied, deploys the Worker, and
   confirms the reported version and commit through `/api/health` plus the public
   catalog smoke endpoint.
6. Private source imports are performed by an authorized operator from a local
   workspace. They never run in GitHub Actions.
7. Rollback redeploys the previous published release. Database changes must use
   an expand/contract strategy once production data must be preserved.
