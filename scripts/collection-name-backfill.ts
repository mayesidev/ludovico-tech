import { z } from "zod";
import { normalizeCollectionName } from "../src/shared/normalize-collection-name";
import { normalizeTitle } from "../src/shared/normalize-title";

export const COLLECTION_NAME_BACKFILL_LIMIT = 10_000;
export const COLLECTION_NAME_READ_SIZE = 1_000;
const batchSize = 100;
const completionQuery =
  "SELECT completed FROM collection_name_backfill WHERE id = 1";
const collectionsQuery = `SELECT hex(CAST(id AS BLOB)) AS id_hex,
  hex(CAST(name AS BLOB)) AS name_hex,
  hex(CAST(name_key AS BLOB)) AS key_hex FROM collections
  ORDER BY id`;
const hexText = z.string().regex(/^(?:[0-9a-f]{2})*$/i);
const collectionSchema = z
  .object({
    id_hex: hexText,
    name_hex: hexText,
    key_hex: hexText,
  })
  .transform(({ id_hex, name_hex, key_hex }) => ({
    id: Buffer.from(id_hex, "hex").toString("utf8"),
    name: Buffer.from(name_hex, "hex").toString("utf8"),
    name_key: Buffer.from(key_hex, "hex").toString("utf8"),
  }));
type Collection = z.infer<typeof collectionSchema>;

export class CollectionNameBackfillError extends Error {}

export type CollectionNameBackfillDatabase = {
  query: (sql: string) => Promise<unknown[]>;
  execute: (sql: string) => Promise<void>;
};

const fail = (message: string): never => {
  throw new CollectionNameBackfillError(message);
};

const isComplete = async (database: CollectionNameBackfillDatabase) => {
  const parsed = z
    .array(z.object({ completed: z.union([z.literal(0), z.literal(1)]) }))
    .length(1)
    .safeParse(await database.query(completionQuery));
  if (!parsed.success) fail("Collection name backfill marker is invalid");
  return parsed.data![0].completed === 1;
};

const readCollections = async (database: CollectionNameBackfillDatabase) => {
  const collections: Collection[] = [];
  for (
    let offset = 0;
    offset <= COLLECTION_NAME_BACKFILL_LIMIT;
    offset += COLLECTION_NAME_READ_SIZE
  ) {
    const limit = Math.min(
      COLLECTION_NAME_READ_SIZE,
      COLLECTION_NAME_BACKFILL_LIMIT + 1 - offset,
    );
    const parsed = z
      .array(collectionSchema)
      .safeParse(
        await database.query(
          `${collectionsQuery} LIMIT ${limit} OFFSET ${offset}`,
        ),
      );
    if (!parsed.success || parsed.data.length > limit)
      fail("Collection name backfill query returned invalid data");
    collections.push(...parsed.data!);
    if (collections.length > COLLECTION_NAME_BACKFILL_LIMIT)
      fail("Collection name backfill exceeds the reviewed collection limit");
    if (parsed.data!.length < limit) break;
  }
  return collections;
};

// Hex text also preserves embedded NULs without placing private names in arguments.
const sqlText = (value: string) =>
  `CAST(X'${Buffer.from(value).toString("hex")}' AS TEXT)`;

export const backfillCollectionNames = async (
  database: CollectionNameBackfillDatabase,
) => {
  if (await isComplete(database)) return { alreadyComplete: true, updated: 0 };
  const before = await readCollections(database);
  const expected = new Map<string, Collection>();
  const keys = new Set<string>();
  for (const collection of before) {
    const legacy = normalizeTitle(collection.name);
    const desired = normalizeCollectionName(collection.name);
    if (
      !desired ||
      (collection.name_key !== legacy && collection.name_key !== desired)
    ) {
      fail("Collection name backfill found an unexpected stored key");
    }
    // This makes the non-overlapping key domains a checked precondition, including on retries.
    if (desired !== legacy && /^[a-z0-9 ]*$/.test(desired)) {
      fail("Collection name backfill found an incompatible key transformation");
    }
    if (keys.has(desired) || expected.has(collection.id)) {
      fail("Collection name backfill found conflicting identities");
    }
    keys.add(desired);
    expected.set(collection.id, { ...collection, name_key: desired });
  }

  const updates = before
    .filter(
      (collection) =>
        collection.name_key !== expected.get(collection.id)!.name_key,
    )
    .map(
      (collection) => `UPDATE collections
    SET name_key = ${sqlText(expected.get(collection.id)!.name_key)}
    WHERE id = ${sqlText(collection.id)} AND name = ${sqlText(collection.name)}
      AND name_key = ${sqlText(collection.name_key)};`,
    );
  for (let offset = 0; offset < updates.length; offset += batchSize) {
    await database.execute(
      updates.slice(offset, offset + batchSize).join("\n"),
    );
  }

  const after = await readCollections(database);
  if (
    after.length !== expected.size ||
    after.some((collection) => {
      const target = expected.get(collection.id);
      return (
        !target ||
        target.name !== collection.name ||
        target.name_key !== collection.name_key
      );
    })
  ) {
    fail(
      "Collection name backfill verification failed; keep maintenance enabled",
    );
  }
  await database.execute(
    "UPDATE collection_name_backfill SET completed = 1 WHERE id = 1;",
  );
  if (!(await isComplete(database)))
    fail("Collection name backfill completion could not be verified");
  return { alreadyComplete: false, updated: updates.length };
};
