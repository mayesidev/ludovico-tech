import { z } from "zod";
import { parseImdbId } from "../shared/imdb";

const imdbId = z
  .string()
  .trim()
  .transform((value, context) => {
    const parsed = parseImdbId(value);
    if (parsed === null || parsed === undefined) {
      context.addIssue({
        code: "custom",
        message: "Use an IMDb ID or IMDb title URL",
      });
      return z.NEVER;
    }
    return parsed;
  })
  .optional()
  .nullable();

const version = z.string().trim().min(1).max(120).optional().nullable();
const versionRuntime = z.number().int().positive().optional().nullable();
const versionReferenceUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Use an HTTP or HTTPS version reference URL",
  })
  .optional()
  .nullable();

export const movieInput = z.object({
  title: z.string().trim().min(1).max(200),
  collectionName: z.string().trim().max(200).optional().default(""),
  imdbId,
  tmdbId: z.number().int().positive().optional().nullable(),
  version,
  versionRuntime,
  versionReferenceUrl,
});

export const movieEditInput = z
  .object({
    collectionName: z.string().trim().max(200).optional().nullable(),
    imdbId,
    title: z.string().trim().min(1).max(200).optional(),
    tmdbId: z.number().int().positive().optional().nullable(),
    version,
    versionRuntime,
    versionReferenceUrl,
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "Provide at least one field",
  );

export const ratingInput = z.object({
  score: z
    .number()
    .min(0)
    .max(5)
    .refine((value) => Number.isInteger(value * 2), "Use whole or half points"),
  phrase: z.string().trim().min(1).max(120),
});

export const orderInput = z.object({
  movieIds: z.array(z.string().trim().min(1).max(200)).min(1),
});

export const libraryQueryInput = z.object({
  direction: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => [25, 50, 100].includes(value), {
      message: "Page size must be 25, 50, or 100",
    })
    .default(50),
  search: z.string().trim().max(200).default(""),
  sort: z
    .enum(["title", "collection", "releaseDate", "addedAt", "rating"])
    .default("title"),
  status: z.enum(["all", "watched", "unwatched"]).default("all"),
});
