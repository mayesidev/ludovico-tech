# Optional private catalog import

The application boots and runs with an empty migrated database. This workflow is
only for an operator who has a selected private legacy export. Source files,
generalized intermediates, reports, and generated SQL stay under `data/`, which
is ignored by git.

Neither command calls TMDB, IMDb, Google, or any other network service.

## Source contract

The sanitizer discards the first CSV record without reading or validating its
text. Remaining fields are mapped by position to these generalized purposes:

| Position | Generalized purpose         |
| -------: | --------------------------- |
|        1 | Submission timestamp        |
|        2 | Movie title                 |
|        3 | Prior-viewing response      |
|        4 | Franchise indicator         |
|        5 | Franchise name              |
|        6 | Legacy IMDb title reference |
|        7 | Shared rating and phrase    |

A franchise name defines membership. An uncertain or disagreeing indicator is a
review warning. A legacy prior-viewing response is retained only as private
provenance and never creates a watched rating.

Ratings may place the 0–5 whole-or-half-point score before or after the required
phrase. A phrase without a parseable score, a score without a phrase, or a value
outside the allowed increments is an error.

## Sanitize and review

Use explicit ignored paths; do not paste private headings or values into command
output, commits, issues, or pull requests.

```sh
pnpm import:sanitize -- \
  data/private-source.csv \
  data/sanitized-import-v1.json \
  data/sanitization-report-v1.json
```

The report contains only source row numbers, generalized diagnostic codes, and
severity. The intermediate is marked `validated: false` whenever a blocking
diagnostic exists, and the SQL generator refuses it. Correct the private source
or a private working copy and sanitize again; do not weaken validation to bypass
a source error.

An optional ignored correction file records reviewed fixes without modifying the
original export. It can replace a fallible legacy IMDb reference, or supply the
generalized score and a clearer phrase when a legacy rating encodes its score as
wordplay:

```json
{
  "schemaVersion": 1,
  "excludedSourceRows": [56],
  "legacyImdbIds": [{ "sourceRow": 10, "id": "tt123456" }],
  "ratings": [
    { "sourceRow": 12, "score": 4 },
    { "sourceRow": 34, "score": 5, "phrase": "Five synthetic marks" }
  ]
}
```

Pass it as the fourth sanitizer argument. A reviewed source-row exclusion drops
that submission before validation or planning and emits a row-number-only
warning. External IDs must use `tt` followed by 6–9 digits. Scores must remain
whole or half points from 0 through 5. Rating corrections apply only to an
otherwise invalid, non-empty rating cell. A duplicate or unknown correction
row, or an attempted override of an already-valid rating, is a blocking error.
Correction files remain under ignored `data/` and must never contain source
headings.

Invalid IMDb references are warnings because IMDb is not an application
dependency. They import without an IMDb identity and can be reconciled against
TMDB in a separate future operator step.

## Generate deterministic SQL

Choose one explicit UTC import timestamp and retain it with the private operator
record. Identical validated input and timestamp produce identical identifiers and
SQL.

```sh
pnpm import:generate -- \
  data/sanitized-import-v1.json \
  data/generated-import-v1 \
  2026-08-07T00:00:00.000Z
```

Generation removes only `chunk-NNNN.sql`, `manifest.json`, and
`validation-report.json` inside the selected output directory. Other files and
directories are left untouched. The manifest lists every chunk in execution
order; do not use an unscoped wildcard from another directory.

The importer uses deterministic identities and preserves every non-excluded
source submission. Submitted title and franchise data are canonical; a legacy IMDb ID
is only a fallible provenance hint. Matching IDs deduplicate rows only when their
normalized title and franchise also agree. If one uncorrected ID points at
different submitted movies, the movies remain distinct and the ambiguous ID is
omitted from both with generalized warnings. Conflicting shared ratings remain a
blocking error. Re-executing the same complete chunk list does not duplicate
data.

A legacy rating establishes watched state. Its sanitized submission timestamp is
used for both `recorded_at` and `watched_at`; unrated titles remain unwatched.

The bulk import never assigns a TMDB identity. A later, separate reconciliation
may suggest a TMDB match, but attaches it only after the title/franchise evidence
is confirmed; a strong conflict leaves the movie unlinked.

## Apply to isolated local D1

Start from a fresh local database when validating a pre-release import:

```sh
pnpm exec wrangler d1 migrations apply ludovico-tech-development \
  --local --env development
```

Then execute every file listed in the private manifest, in order:

```sh
pnpm exec wrangler d1 execute ludovico-tech-development \
  --local --env development \
  --file=data/generated-import-v1/chunk-0001.sql
```

Repeat that command for the remaining manifest entries, including the final
chunk. Automated tests execute synthetic generated chunks twice against isolated
D1 to verify completeness, constraints, and idempotency.

Do not apply private import artifacts to production as part of bootstrap or CI.
Production import and later TMDB reconciliation require a separately reviewed
operator run.
