import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./env";

describe("movie identity helpers", () => {
  it("normalizes titles for matching", () => {
    expect(normalizeTitle("The Wizard of Oz!")).toBe("the wizard of oz");
  });
});
