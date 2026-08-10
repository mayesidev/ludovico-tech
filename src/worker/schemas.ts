import { z } from "zod";

export const movieInput = z.object({
  title: z.string().trim().min(1).max(200),
  franchiseName: z.string().trim().max(200).optional().default(""),
  tmdbId: z.number().int().positive().optional().nullable(),
});

export const movieEditInput = z
  .object({
    franchiseName: z.string().trim().max(200).optional().nullable(),
    title: z.string().trim().min(1).max(200).optional(),
    tmdbId: z.number().int().positive().optional().nullable(),
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
