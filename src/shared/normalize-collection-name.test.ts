import { describe, expect, it } from "vitest";
import { normalizeCollectionName } from "./normalize-collection-name";
import { normalizeTitle } from "./normalize-title";

describe("collection name identity", () => {
  it.each([
    ["Café", "CAFE"],
    ["Ångström", "angstrom"],
    ["cafe\u0301", "Cafe"],
    ["Москва", "МОСКВА"],
    ["が", "か\u3099"],
    [" Saga-One ", "saga one"],
    ["ＡＢＣ", "abc"],
    ["A☀️", "A☀"],
    ["a\u1ab0\u0301", "a\u1ab0"],
    ["A!́B", "A!B"],
  ])("matches equivalent names %s and %s", (left, right) => {
    expect(normalizeCollectionName(left)).toBe(normalizeCollectionName(right));
  });

  it.each([
    ["東宝", "松竹"],
    ["Москва", "Киев"],
    ["か", "が"],
    ["क", "कि"],
    ["!!!", "???"],
    ["🎬", "🎭"],
    ["👍", "👍🏽"],
    ["☀️", "☂️"],
    ["☀️", "❤️"],
  ])("keeps distinct names %s and %s", (left, right) => {
    expect(normalizeCollectionName(left)).not.toBe(
      normalizeCollectionName(right),
    );
    expect(normalizeCollectionName(left)).not.toBe("");
    expect(normalizeCollectionName(right)).not.toBe("");
  });

  it("leaves empty queries empty", () => {
    expect(normalizeCollectionName(" \t\n")).toBe("");
  });

  it.each([
    "İSTANBUL",
    "ΟΣ",
    "ὈΔΥΣΣΕΎΣ",
    "Straße",
    "ẞ",
    "ﬃ",
    "Æ",
    "東宝 Saga",
    "A\u0301\u3099B",
    "A\u3099\u0301B",
    "\u0301A",
    "\u0130\u0301 X",
    "🎬  !!!",
    "!!!",
    "किं",
    "ＡＢＣ",
    "a\u034fb",
    "A\u0301.Σ",
  ])("keeps changed keys outside the old ASCII key domain: %s", (name) => {
    const current = normalizeCollectionName(name);
    if (current !== normalizeTitle(name))
      expect(current).not.toMatch(/^[a-z0-9 ]*$/);
  });
});
