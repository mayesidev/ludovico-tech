export const normalizeCollectionName = (name: string) => {
  const decomposed = name
    .normalize("NFKD")
    // Latin accents remain interchangeable; marks in other scripts can distinguish names.
    .replace(
      /(\p{Script=Latin})(\p{M}+)/gu,
      (_match, letter: string, marks: string) =>
        letter + marks.replace(/[\u0300-\u036f]/g, ""),
    )
    .toLowerCase();

  return /[\p{L}\p{N}]/u.test(decomposed)
    ? decomposed
        .replace(/[\p{P}\p{S}][\p{M}\p{Cf}]*/gu, " ")
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
        .trim()
    : name.normalize("NFKC").toLowerCase().trim();
};
