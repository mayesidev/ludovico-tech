// SQLite LIKE stops at the first NUL and folds ASCII case only.
export const sqliteSearchText = (expression: string) =>
  `LOWER(SUBSTR(${expression}, 1, LENGTH(${expression})))`;

export const literalSubstringSearch = (search: string) => {
  const nul = search.indexOf("\0");
  const value = nul < 0 ? search : search.slice(0, nul);
  // A NUL in the old `%query%` pattern removes its trailing wildcard.
  const suffix = nul >= 0 && value.length > 0;
  return {
    bindings: suffix ? [value, value] : [value],
    condition: (expression: string) =>
      suffix
        ? `SUBSTR(${sqliteSearchText(expression)}, -LENGTH(?)) = LOWER(?)`
        : `INSTR(${sqliteSearchText(expression)}, LOWER(?)) > 0`,
  };
};
