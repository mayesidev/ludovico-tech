import { z } from "zod";

export const TMDB_METADATA_RULES = {
  request: {
    appendToResponse: ["credits"],
    language: "en-US",
  },
  collection: {
    nameMaxLength: 200,
  },
  movie: {
    posterPathPattern: "^/[A-Za-z0-9._-]{1,200}$",
    releaseDatePattern: "^\\d{4}-\\d{2}-\\d{2}$",
    runtimeZeroAsNull: true,
    titleMaxLength: 200,
  },
  people: {
    cast: {
      deduplicateBy: "tmdb_person_id",
      limit: 5,
      orderBy: ["billing_order", "response_order"],
    },
    directors: {
      deduplicateBy: "tmdb_person_id",
      job: "Director",
      limit: 3,
      orderBy: ["response_order"],
    },
    nameMaxLength: 200,
  },
} as const;

export const tmdbPersonSchema = z
  .object({
    id: z.number().int().positive(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(TMDB_METADATA_RULES.people.nameMaxLength),
  })
  .strict();

export const tmdbCollectionSchema = z
  .object({
    id: z.number().int().positive(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(TMDB_METADATA_RULES.collection.nameMaxLength),
  })
  .strict();

export const tmdbMovieDetailSchema = z
  .object({
    cast: z.array(tmdbPersonSchema).max(TMDB_METADATA_RULES.people.cast.limit),
    collection: tmdbCollectionSchema.nullable(),
    directors: z
      .array(tmdbPersonSchema)
      .max(TMDB_METADATA_RULES.people.directors.limit),
    id: z.number().int().positive(),
    posterPath: z
      .string()
      .regex(new RegExp(TMDB_METADATA_RULES.movie.posterPathPattern))
      .nullable(),
    releaseDate: z
      .string()
      .regex(new RegExp(TMDB_METADATA_RULES.movie.releaseDatePattern))
      .nullable(),
    runtimeMinutes: z.number().int().positive().nullable(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(TMDB_METADATA_RULES.movie.titleMaxLength),
  })
  .strict()
  .superRefine((movie, context) => {
    for (const field of ["cast", "directors"] as const) {
      const ids = new Set<number>();
      for (const person of movie[field]) {
        if (ids.has(person.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate ${field} TMDB person ID`,
            path: [field],
          });
        }
        ids.add(person.id);
      }
    }
  });

export type TmdbPerson = z.infer<typeof tmdbPersonSchema>;
export type TmdbCollection = z.infer<typeof tmdbCollectionSchema>;
export type TmdbMovieDetail = z.infer<typeof tmdbMovieDetailSchema>;

const storedShape = Object.fromEntries(
  Object.entries(
    z.toJSONSchema(tmdbMovieDetailSchema, { io: "output" }),
  ).filter(([key]) => key !== "$schema"),
);

export const TMDB_METADATA_CONTRACT = {
  normalization: TMDB_METADATA_RULES,
  storedShape,
} as const;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

export const fingerprintTmdbMetadataContract = async (contract: unknown) => {
  const encoded = new TextEncoder().encode(
    JSON.stringify(canonicalize(contract)),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hash}`;
};

let currentContractId: Promise<string> | undefined;

export const getTmdbMetadataContractId = () => {
  currentContractId ??= fingerprintTmdbMetadataContract(TMDB_METADATA_CONTRACT);
  return currentContractId;
};
