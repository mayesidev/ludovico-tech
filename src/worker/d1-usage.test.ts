import { describe, expect, it } from "vitest";
import {
  createD1ProcessingUsage,
  recordD1BatchUsage,
  recordD1Usage,
} from "./d1-usage";

const result = (
  rowsRead: number,
  rowsWritten: number,
  totalAttempts = 1,
): Pick<D1Result, "meta"> => ({
  meta: {
    changed_db: rowsWritten > 0,
    changes: rowsWritten,
    duration: 0,
    last_row_id: 0,
    rows_read: rowsRead,
    rows_written: rowsWritten,
    size_after: 0,
    total_attempts: totalAttempts,
  },
});

describe("D1 processing usage", () => {
  it("adds query and batch rows without counting retries twice", () => {
    const usage = createD1ProcessingUsage();

    recordD1Usage(usage, result(5, 0));
    recordD1BatchUsage(usage, [result(2, 3), result(7, 4, 2)]);

    expect(usage).toEqual({ retried: true, rowsRead: 14, rowsWritten: 7 });
  });
});
