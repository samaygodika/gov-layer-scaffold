/**
 * Dev seed: the three actors from the spec and their permission grants.
 *
 * Runs as scaffold_owner: actor and permission_grant are scaffold-owned
 * reference data that app_role can only SELECT, so seeding them is an
 * administrative step, not something the application could do.
 */
import pg from "pg";
import { ownerDatabaseUrl } from "./env.js";
import { SEED_ACTORS, SEED_GRANTS } from "./seed-data.js";

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

    if (process.argv.some((arg) => arg.startsWith("--rows="))) {
      console.log("--rows: no app tables exist yet; app sessions seed their own load data");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

await seed();
