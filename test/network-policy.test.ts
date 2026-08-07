import { describe, expect, it } from "vitest";

describe("automated test network policy", () => {
  it("denies fetch unless a test supplies an explicit fake", async () => {
    await expect(fetch("https://example.test")).rejects.toThrow(
      "Unexpected outbound network request",
    );
  });
});
