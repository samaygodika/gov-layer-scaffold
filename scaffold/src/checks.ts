/**
 * The two CI guardrails, as functions so both the passing and the failing case
 * can be tested (spec SC-8, SC-10).
 *
 * Each check is split into a query and a pure assertion over its rows: the
 * assertion is what CI relies on, and testing it against a hand-made row is how
 * the failing case is proved without granting the test suite DDL rights.
 * `npm run tamper-check` additionally runs both checks against a real
 * trigger-less table and a real bypassing route.
 */
import type { Queryable } from "./db.js";
import type { RouteKey, ScaffoldServer } from "./server.js";

/**
 * Tables the audit check ignores. The scaffold's own tables are audited or
 * deliberately not (actor is IdP-synced, permission_grant is configuration,
 * audit_event is the log itself), and schema_migration is the migration ledger.
 */
export const NON_APP_TABLES = [
  "_scaffold_fixture",
  "actor",
  "approval",
  "audit_event",
  "permission_grant",
  "schema_migration",
] as const;

export type TableAudit = { table: string; auditTrigger: boolean };

/** Every table in public that an app session created, and whether audit_row() is attached. */
export async function appTableAudits(client: Queryable): Promise<TableAudit[]> {
  const rows = await client.query<{ table: string; audit_trigger: boolean }>(
    `SELECT c.relname AS table,
            EXISTS (
              SELECT 1 FROM pg_trigger t
               WHERE t.tgrelid = c.oid
                 AND NOT t.tgisinternal
                 AND t.tgfoid = 'audit_row'::regproc
            ) AS audit_trigger
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> ALL ($1::text[])
      ORDER BY c.relname`,
    [[...NON_APP_TABLES]],
  );
  return rows.rows.map((row) => ({ table: row.table, auditTrigger: row.audit_trigger }));
}

export const unauditedTables = (audits: TableAudit[]): string[] =>
  audits.filter((audit) => !audit.auditTrigger).map((audit) => audit.table);

/** The assertion behind all_app_tables_are_audited. */
export function assertAllAppTablesAreAudited(audits: TableAudit[]): void {
  const missing = unauditedTables(audits);
  if (missing.length > 0) {
    throw new Error(
      `tables without the audit trigger: ${missing.join(", ")}. ` +
        "Attach it in the migration that creates the table: " +
        "CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON <table> " +
        "FOR EACH ROW EXECUTE FUNCTION audit_row();",
    );
  }
}

/** The assertion behind all_routes_are_registered. */
export function assertAllRoutesAreRegistered(server: ScaffoldServer): void {
  assertNoRoutesOutsideRegistry(server.routesOutsideRegistry());
}

export function assertNoRoutesOutsideRegistry(outside: RouteKey[]): void {
  if (outside.length > 0) {
    const listed = outside.map((route) => `${route.method} ${route.path}`).join(", ");
    throw new Error(
      `routes registered outside route(): ${listed}. ` +
        "These skipped authorize(); declare them with route() instead.",
    );
  }
}
