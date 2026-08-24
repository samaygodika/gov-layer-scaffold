/**
 * npm run tamper-check — the first two violations of verification-addendum.md §F,
 * run against a real database instead of a hand-made fixture.
 *
 * It creates a throwaway table with no audit trigger and a route registered
 * straight onto the framework, asserts that each CI guardrail fires, and cleans
 * up. This is a script and not a test on purpose: creating the table needs DDL,
 * which means a scaffold_owner connection, and the test suite connects as
 * app_role only. The checks themselves run as app_role.
 */
import pg from "pg";
import {
  appTableAudits,
  assertAllAppTablesAreAudited,
  assertAllRoutesAreRegistered,
} from "./checks.js";
import { createDemoServer } from "./demo-server.js";
import { appDatabaseUrl, ownerDatabaseUrl } from "./env.js";
import { unsafeRawServer } from "./unsafe-raw-server.js";
import { closeAppPool } from "./with-actor.js";

const TAMPER_TABLE = "_tamper_no_audit";

async function expectThrow(what: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.log(`caught  ${what}: ${(error as Error).message}`);
    return;
  }
  throw new Error(`guardrail did not fire: ${what}`);
}

async function tableWithoutAuditTrigger(): Promise<void> {
  const owner = new pg.Client({ connectionString: ownerDatabaseUrl() });
  const app = new pg.Client({ connectionString: appDatabaseUrl() });
  await owner.connect();
  await app.connect();
  try {
    await owner.query(`CREATE TABLE ${TAMPER_TABLE} (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
    await owner.query(`GRANT SELECT ON ${TAMPER_TABLE} TO app_role`);
    await expectThrow("all_app_tables_are_audited", async () =>
      assertAllAppTablesAreAudited(await appTableAudits(app)),
    );
  } finally {
    await owner.query(`DROP TABLE IF EXISTS ${TAMPER_TABLE}`);
    await owner.end();
    await app.end();
  }
}

async function routeOutsideTheRegistry(): Promise<void> {
  const server = createDemoServer();
  try {
    assertAllRoutesAreRegistered(server);
    unsafeRawServer(server).get("/bypass", async () => ({ authorized: "never asked" }));
    await server.ready();
    await expectThrow("all_routes_are_registered", () => assertAllRoutesAreRegistered(server));
  } finally {
    await server.close();
  }
}

await tableWithoutAuditTrigger();
await routeOutsideTheRegistry();
await closeAppPool();
console.log("ok: both guardrails fired");
