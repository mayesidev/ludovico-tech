# Catalog import

Use the catalog importer to initialize an empty, migrated Ludovico Tech database
from an existing library. Source CSV files must remain under ignored `data/`
paths.

Never paste private catalog values into logs, commits, issues, or pull requests.
Validation failures report only diagnostic codes and CSV row numbers.

## Prepare the CSV

The supported columns are defined by
[`catalog-import-template.csv`](catalog-import-template.csv). The header may use
any supported subset in any order, but it must include `title`. Unknown or
duplicate columns are rejected. A CSV containing only a `title` column is a
complete valid import.

| Column                | Requirement                                                         | Application behavior                                                                  |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `title`               | Required; 1–200 characters                                          | Creates the movie title.                                                              |
| `added_at`            | Optional ISO 8601 UTC timestamp                                     | Preserves a known library addition time. The explicit import time is used when blank. |
| `rating_score`        | Optional; paired with `rating_phrase`; 0–5 in half-point increments | Creates a rating and therefore marks the title watched.                               |
| `rating_phrase`       | Optional; paired with `rating_score`; 1–120 characters              | Creates the rating phrase.                                                            |
| `collection`          | Optional; 1–200 characters                                          | Creates local collection membership.                                                  |
| `collection_position` | Optional; requires `collection`                                     | Confirms collection order when every member has one unique contiguous position.       |
| `tmdb_id`             | Optional positive integer; unique in the import                     | Creates only a TMDB link due for application-managed backfill.                        |
| `now_showing`         | Optional; blank or `false`, with at most one `true` value           | Sets that unwatched title as Now Showing.                                             |

The importer rejects duplicate normalized titles, duplicate TMDB IDs, partial
ratings, a watched or multiply selected Now Showing title, and partial or
non-contiguous collection ordering. It does not accept IMDb IDs, prior-viewed
flags, source provenance, provider metadata, users, sessions, rolls, audit events,
or unknown timestamps.

## Preflight and import

The command start time defaults blank `added_at` values and records imported
ratings; it does not invent watch times.

```sh
pnpm import:catalog -- \
  --environment production \
  --database ludovico-tech-production \
  --csv data/catalog.csv
```

Without `--execute`, the command validates the CSV and reports counts without
contacting a database. Review that summary before adding `--execute`. Execution
validates the checked-in environment configuration and applied migrations,
requires an empty migrated target, imports bounded multi-row inserts, and verifies
exact movie, collection, membership, rating, TMDB-link, and Now Showing state
afterward. The database confirmation must exactly match the selected environment.
TMDB IDs create only link rows queued for the application's normal TMDB refresh.

Exercise the CSV first against a newly migrated isolated local database. Use the
same persistence directory for migration and import:

```sh
pnpm exec wrangler d1 migrations apply ludovico-tech-development \
  --local --env development --persist-to <isolated-directory>
pnpm import:catalog -- \
  --environment development \
  --database ludovico-tech-development \
  --csv data/catalog.csv \
  --persist-to <isolated-directory> \
  --execute
```

Do not run private imports in CI or as part of application deployment. A remote
import is a separate reviewed operator action. SQL files required by Wrangler are
created in a private temporary directory and removed when the command finishes.
If a write or post-import check fails, stop and review the unreleased target
before resetting or retrying it.
