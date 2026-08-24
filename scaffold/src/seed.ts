/**
 * Dev seed: the three actors from the spec and their permission grants.
 *
 * Runs as scaffold_owner: actor and permission_grant are scaffold-owned
 * reference data that app_role can only SELECT, so seeding them is an
 * administrative step, not something the application could do.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { ownerDatabaseUrl } from "./env.js";
import { appsDir } from "./paths.js";
import { SEED_ACTORS, SEED_GRANTS } from "./seed-data.js";

/**
 * App fixtures are discovered the same way governance-report discovers apps:
 * `apps/<name>/server/seed.ts` exporting `seedApp(client, { rows })`. `rows`
 * comes from `--rows=N`; without it an app seeds its small default set.
 */
type SeedApp = (client: pg.Client, options: { rows: number | undefined }) => Promise<string>;

async function appSeeds(): Promise<{ name: string; seedApp: SeedApp }[]> {
  let entries: string[];
  try {
    entries = await readdir(appsDir);
  } catch {
    return [];
  }
  const found: { name: string; seedApp: SeedApp }[] = [];
  for (const name of entries.sort()) {
    const entrypoint = join(appsDir, name, "server", "seed.ts");
    const exists = await stat(entrypoint).then(
      () => true,
      () => false,
    );
    if (!exists) continue;
    const module: unknown = await import(pathToFileURL(entrypoint).href);
    const seedApp = (module as { seedApp?: SeedApp }).seedApp;
    if (typeof seedApp !== "function") {
      throw new Error(`${entrypoint} must export seedApp(client, { rows })`);
    }
    found.push({ name, seedApp });
  }
  return found;
}

function requestedRows(): number | undefined {
  const flag = process.argv.find((arg) => arg.startsWith("--rows="));
  if (!flag) return undefined;
  const rows = Number.parseInt(flag.slice("--rows=".length), 10);
  if (!Number.isInteger(rows) || rows < 0) throw new Error(`--rows must be a whole number: ${flag}`);
  return rows;
}

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerDatabaseUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const actor of SEED_ACTORS) {
      await client.query(
        `INSERT INTO actor (id, external_subject, email, groups, active)
           VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (external_subject) DO UPDATE
           SET email = excluded.email, groups = excluded.groups, active = true`,
        [actor.id, actor.externalSubject, actor.email, actor.groups],
      );
    }
    for (const grant of SEED_GRANTS) {
      await client.query(
        `INSERT INTO permission_grant (role, resource_type, action)
           VALUES ($1, $2, $3)
         ON CONFLICT (role, resource_type, action) DO NOTHING`,
        [grant.role, grant.resourceType, grant.action],
      );
    }
    await client.query("COMMIT");
    console.log(`seeded ${SEED_ACTORS.length} actors, ${SEED_GRANTS.length} permission grants`);

    const rows = requestedRows();
    const seeds = await appSeeds();
    for (const { name, seedApp } of seeds) {
      console.log(`${name}: ${await seedApp(client, { rows })}`);
    }
    if (seeds.length === 0) {
      console.log("no apps/<name>/server/seed.ts found; app sessions seed their own fixtures");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

await seed();
