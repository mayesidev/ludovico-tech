# Collection identity cutover

Collection matching is case-insensitive and folds Latin accents, so Café and Cafe
identify the same collection. Other Unicode letters, numbers, and meaningful
marks remain significant: 東宝 and 松竹, or か and が, identify distinct collections.
Punctuation separates words in text names as before. Names containing only
symbols or punctuation keep their full normalized identity, including emoji
variation selectors. The movie import title identity rules are unchanged.

Migration `0029_collection_name_backfill.sql` renames the indexed collection key
to `collections.name_key` and the membership table to `collection_memberships`.
It also creates the completion marker for the one-time data backfill. Existing
collection IDs, names, memberships, positions, timestamps, and attribution stay
intact. Previously merged collections are not split or reconstructed.

## Deployment and compatibility

This is a breaking schema and data change. All deployment workflows verify the
exact new release in maintenance mode, wait for refresh activity to stop, apply
and verify migrations, and complete the collection-name backfill before
activating that same release. Production retains its pre-migration recovery
checkpoint. The backfill is required when the release includes migration 0029;
its successful completion makes subsequent runs a constant-size marker check.

Maintenance routing does not prove that older HTTP requests have finished. The
renamed database write surfaces reject older collection inserts and membership
mutations, including a delayed request that already resolved a collection ID.
An incompatible D1 batch fails atomically, so an earlier movie write in that
batch is also rolled back. Old member operations may therefore fail during this
maintenance cutover. The fence does not claim to reject unrelated scalar-only
movie edits from an older invocation.

An older active application cannot use this schema and must not be deployed as a
rollback. Deployment failures retain the new release in maintenance. Recovery
requires a reviewed forward correction or coordinated database/code recovery;
it is not an automatic older-version rollback.

## Backfill behavior and recovery

The dedicated command reads at most 10,001 collection rows in batches of 1,000,
ordered by ID. It accumulates the entire bounded set before preflight and uses
the same bounded reads for final verification. More than 10,000
collections aborts without writes and requires a reviewed maintenance plan;
this is an execution guard, not an application input limit. Before writing, it
checks every retained name and desired key for collisions and verifies that each
stored key is either its legacy key or its new key. Conflicting identities or
unexpected keys stop the operation without guessing how to merge collections.

Conditional updates change only the key, in batches of at most 100 collections.
The command verifies every key and the complete row set before persisting
completion. An interrupted operation can be rerun: already converted keys are
accepted, and remaining updates are conditional. A verification or collision
failure keeps maintenance enabled until reviewed. The command captures database
output privately and reports only fixed diagnostics or counts; it does not print
collection names or identifiers.

For local development, follow the migration and backfill commands in the README
using the same local persistence directory. The command requires an explicit
configured environment, matching database name, and `--execute`; local execution
also requires `--persist-to`. Do not run it against a live database outside the
reviewed maintenance deployment workflow.
