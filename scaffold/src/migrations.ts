import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

/** Every migration, in the order the runner applies them: filename order. */
export async function migrationFilenames(): Promise<string[]> {
  const entries = await readdir(migrationsDir);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

export const readMigration = (filename: string): Promise<string> =>
  readFile(join(migrationsDir, filename), "utf8");
