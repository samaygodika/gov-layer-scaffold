/**
 * Migration runner. Applies every migrations/*.sql in filename order as
 * scaffold_owner, one transaction per file, recording each in schema_migration.
 * Already-applied files are skipped, so it is safe to re-run.
 */
import pg from "pg";
import { ownerDatabaseUrl } from "./env.js";
import { migrationFilenames, readMigration } from "./migrations.js";

async function migrate(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerDatabaseUrl() });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ filename: string }>("SELECT filename FROM schema_migration")).rows.map(
        (row) => row.filename,
      ),
    );

    for (const filename of await migrationFilenames()) {
      if (applied.has(filename)) {
        console.log(`skip  ${filename}`);
        continue;
      }
      const sql = await readMigration(filename);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migration (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${filename} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      console.log(`apply ${filename}`);
    }
  } finally {
    await client.end();
  }
}

await migrate();
