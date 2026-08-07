import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  assertAllowedProductionLicenses,
  runProductionLicenseCheck,
} from "./production-licenses";

describe("production dependency licenses", () => {
  it("accepts only the reviewed production license set", () => {
    expect(() =>
      assertAllowedProductionLicenses({
        "Apache-2.0": [{ name: "synthetic-apache-package" }],
        ISC: [{ name: "synthetic-isc-package" }],
        MIT: [{ name: "synthetic-mit-package" }],
      }),
    ).not.toThrow();
  });

  it("fails closed for new licenses and malformed reports", () => {
    expect(() =>
      assertAllowedProductionLicenses({
        GPL: [{ name: "synthetic-unreviewed-package" }],
      }),
    ).toThrow(/GPL/);
    expect(() => assertAllowedProductionLicenses({})).toThrow();
    expect(() => assertAllowedProductionLicenses([])).toThrow();
    expect(() => assertAllowedProductionLicenses({ MIT: null })).toThrow();
  });

  it("validates the JSON report received from the pnpm pipeline", async () => {
    await expect(
      runProductionLicenseCheck(
        Readable.from([JSON.stringify({ MIT: [{ name: "synthetic" }] })]),
      ),
    ).resolves.toBeUndefined();
    await expect(
      runProductionLicenseCheck(Readable.from(["not-json"])),
    ).rejects.toThrow();
  });
});
