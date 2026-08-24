/** SC-12: the scaffold ships no UI. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as scaffold from "../src/index.js";
import { repoRoot } from "../src/paths.js";

const scaffoldDir = join(repoRoot, "scaffold");

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files;
}

describe("the scaffold's public surface", () => {
  it("SC-12 contains no UI source files", async () => {
    const uiFiles = (await filesUnder(scaffoldDir)).filter((file) =>
      /\.(tsx|jsx|css|scss|svg|html)$/.test(file),
    );
    expect(uiFiles).toEqual([]);
  });

  it("SC-12 depends on no UI package", async () => {
    const manifest = JSON.parse(await readFile(join(scaffoldDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(dependencies.filter((name) => /^(react|react-dom|vite|@vitejs)/.test(name))).toEqual([]);
  });

  it("SC-12 exports no component and no framework router", () => {
    const exported = Object.entries(scaffold);
    expect(exported.length).toBeGreaterThan(0);
    for (const [name, value] of exported) {
      expect(name).not.toMatch(/^(fastify|router|app)$/i);
      expect((value as { $$typeof?: symbol }).$$typeof).toBeUndefined();
      expect(
        (value as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent,
      ).toBeUndefined();
    }
    expect(Object.keys(scaffold)).not.toContain("unsafeRawServer");
  });
});
