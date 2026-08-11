# Optional private catalog import

Use this only for a selected private legacy export. The application does not need
the source artifact to start. Source files, corrections, generalized intermediates,
reports, and generated SQL stay under ignored `data/` paths.

Never paste source headings or values into logs, commits, issues, or pull requests.
The positional source contract, public-safe intermediate types, validation, and
diagnostic codes are defined in
[`scripts/import-sheet-lib.ts`](../scripts/import-sheet-lib.ts) and its synthetic
tests. Sanitization and generation do not call external services; only the
explicit reconciliation stage does.

## Sanitize

```sh
pnpm import:sanitize -- \
  data/private-source.csv \
  data/sanitized-import-v1.json \
  data/sanitization-report-v1.json \
  data/import-corrections-v1.json
```

The correction file is optional. Its accepted public-safe shape is enforced by
`parseImportCorrectionsJson` and the sanitizer tests. Resolve blocking diagnostics
in a private source or correction file and rerun sanitization; do not weaken the
validator.

## Reconcile external metadata (optional)

```sh
pnpm import:reconcile -- \
  data/sanitized-import-v1.json \
  data/tmdb-reconciliation-v1.json \
  data/tmdb-reconciliation-report-v1.json \
  data/tmdb-reconciliation-cache-v1.json
```

This manual stage calls TMDB sequentially and caches each sanitized lookup. It
confirms only one exact normalized title match. Conflicts remain unlinked for
private review, and an interrupted run resumes from its cache.

## Generate

Choose and retain one explicit UTC import time:

```sh
pnpm import:generate -- \
  data/sanitized-import-v1.json \
  data/generated-import-v1 \
  2026-08-08T00:00:00.000Z \
  data/tmdb-reconciliation-v1.json
```

The reconciliation argument is optional. The generator records the artifact
type, ordered chunks, checksums, expected counts, and Now Showing state in the
manifest.

For an already-imported environment, generate an update-only metadata artifact
instead of replaying the structural import:

```sh
pnpm import:metadata -- \
  data/sanitized-import-v1.json \
  data/tmdb-reconciliation-v1.json \
  data/generated-tmdb-metadata-v1 \
  2026-08-10T00:00:00.000Z
```

Its manifest is labeled `tmdb_metadata`; its chunks update confirmed movie
metadata without inserting or changing catalog structure, ratings, or queue state.

## Preflight and apply

Preflight validates both artifacts without contacting a database:

```sh
pnpm import:apply -- \
  --environment production \
  --database ludovico-tech-production \
  --catalog data/generated-import-v1 \
  --metadata data/generated-tmdb-metadata-v1
```

Review that summary before adding `--execute`. Execution validates the checked-in
environment configuration and applied migrations, requires an empty migrated
target, applies catalog chunks before metadata chunks, and verifies generalized
counts and Now Showing state afterward. The database confirmation must exactly
match the selected environment.

Exercise the command first against a newly migrated, isolated local database. Use
the same persistence directory for migration and import:

```sh
pnpm exec wrangler d1 migrations apply ludovico-tech-development \
  --local --env development --persist-to <isolated-directory>
pnpm import:apply -- \
  --environment development \
  --database ludovico-tech-development \
  --catalog data/generated-import-v1 \
  --metadata data/generated-tmdb-metadata-v1 \
  --persist-to <isolated-directory> \
  --execute
```

Do not run private imports in CI or as part of application deployment. Any remote
import is a separate reviewed operator action. If a chunk or post-import check
fails, stop: do not blindly replay the artifact. Review and reset or recreate the
unreleased target before trying again.
