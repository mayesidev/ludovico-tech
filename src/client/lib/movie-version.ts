export const parseVersionRuntime = (
  value: string,
): number | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const runtime = Number(trimmed);
  return Number.isSafeInteger(runtime) ? runtime : undefined;
};

export const parseVersionReferenceUrl = (
  value: string,
): string | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
};
