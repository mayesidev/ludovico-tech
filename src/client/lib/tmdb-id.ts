export const parseTmdbId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};
