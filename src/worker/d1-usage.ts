export type D1ProcessingUsage = {
  retried: boolean;
  rowsRead: number;
  rowsWritten: number;
};

export const createD1ProcessingUsage = (): D1ProcessingUsage => ({
  retried: false,
  rowsRead: 0,
  rowsWritten: 0,
});

export const recordD1Usage = (
  usage: D1ProcessingUsage | undefined,
  result: Pick<D1Result, "meta">,
) => {
  if (!usage) return;
  usage.rowsRead += result.meta.rows_read;
  usage.rowsWritten += result.meta.rows_written;
  usage.retried ||= (result.meta.total_attempts ?? 1) > 1;
};

export const recordD1BatchUsage = (
  usage: D1ProcessingUsage | undefined,
  results: Array<Pick<D1Result, "meta">>,
) => {
  for (const result of results) recordD1Usage(usage, result);
};
