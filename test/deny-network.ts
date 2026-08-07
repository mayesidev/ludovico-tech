import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected outbound network request in an automated test"),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});
