import { z } from "zod";

export const movieInput = z.object({
  title: z.string().trim().min(1).max(200),
  franchiseName: z.string().trim().max(200).optional().default(""),
  releaseDate: z.string().trim().max(20).optional().nullable(),
  posterPath: z.string().trim().max(300).optional().nullable(),
  tmdbId: z.number().int().positive().optional().nullable(),
  imdbId: z.string().trim().max(30).optional().nullable(),
});

export const movieEditInput = movieInput
  .partial()
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
  phrase: z.string().trim().max(120).optional().default(""),
});

export const orderInput = z.object({
  movieIds: z.array(z.string().uuid()).min(1),
});
