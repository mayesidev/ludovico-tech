import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const allowedLicenses = new Set(["Apache-2.0", "ISC", "MIT"]);

export const assertAllowedProductionLicenses = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Production license report is invalid");
  }
  const licenses = Object.keys(value);
  if (!licenses.length) throw new Error("Production license report is empty");
  if (
    Object.values(value).some(
      (dependencies) =>
        !Array.isArray(dependencies) || dependencies.length === 0,
    )
  ) {
    throw new Error("Production license report contains invalid entries");
  }
  const disallowed = licenses.filter(
    (license) => !allowedLicenses.has(license),
  );
  if (disallowed.length) {
    throw new Error(
      `Production dependencies require license review: ${disallowed.sort().join(", ")}`,
    );
  }
};

export const runProductionLicenseCheck = async (
  input: NodeJS.ReadableStream,
) => {
  let source = "";
  input.setEncoding("utf8");
  for await (const chunk of input) source += String(chunk);
  assertAllowedProductionLicenses(JSON.parse(source) as unknown);
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  runProductionLicenseCheck(process.stdin).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "License check failed",
    );
    process.exitCode = 1;
  });
}
