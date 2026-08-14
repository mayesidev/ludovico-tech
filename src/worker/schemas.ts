import { z } from "zod";

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
  tmdbId: z.number().int().positive().optional().nullable(),
  version,
  versionRuntime,
  versionReferenceUrl,
});

export const movieEditInput = z
  .object({
    collectionName: z.string().trim().max(200).optional().nullable(),
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
