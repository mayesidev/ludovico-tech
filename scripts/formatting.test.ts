import { fileURLToPath } from "node:url";
import { check, format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";

const optionsFor = async (extension: string) => {
  const filepath = fileURLToPath(
    new URL(`../src/formatting-fixture.${extension}`, import.meta.url),
  );
  const configuration = await resolveConfig(filepath);

  if (!configuration) {
    throw new Error("Repository Prettier configuration is required");
  }

  return { ...configuration, filepath };
};

describe("repository formatting", () => {
  it.each(["ts", "tsx", "js", "mjs"])(
    "organizes %s imports and removes unused bindings",
    async (extension) => {
      const options = await optionsFor(extension);
      const source = `import { beta, unused } from "example";
import { alpha } from "example";
import { unusedModule } from "unused-example";
import "./setup";

export const result = alpha(beta);
`;

      const output = await format(source, options);

      expect(output).toContain('import { alpha, beta } from "example";');
      expect(output).not.toContain("unused");
      expect(output).toContain('import "./setup";');
      expect(output).toContain("export const result = alpha(beta);");
      await expect(format(output, options)).resolves.toBe(output);
      await expect(check(source, options)).resolves.toBe(false);
      await expect(check(output, options)).resolves.toBe(true);
    },
  );

  it("retains used type-only imports and removes unused types", async () => {
    const options = await optionsFor("ts");
    const output = await format(
      `import type { Unused, Used } from "example";
export type Result = Used;
`,
      options,
    );

    expect(output).toContain('import type { Used } from "example";');
    expect(output).not.toContain("Unused");
    expect(output).toContain("export type Result = Used;");
  });

  it("retains components used in JSX while removing unused imports", async () => {
    const options = await optionsFor("tsx");
    const output = await format(
      `import { Unused, Widget } from "example";
export const view = <Widget />;
`,
      options,
    );

    expect(output).toContain('import { Widget } from "example";');
    expect(output).not.toContain("Unused");
    expect(output).toContain("export const view = <Widget />;");
  });
});
