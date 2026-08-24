/**
 * The governance report (verification-addendum.md §A).
 *
 * Everything here is read out of the database or the route registry — never out
 * of a hand-maintained list — so two apps built on the same scaffold produce
 * files that differ only in app name, table names and route paths. Ordering is
 * fixed (keys in declaration order, every array sorted) so the two files diff
 * cleanly.
 */
import type { Queryable } from "./db.js";
import type { ScaffoldServer } from "./server.js";

export type GovernanceTable = { name: string; pk: string; audit_trigger: boolean };

export type GovernanceRoute = {
  method: string;
  path: string;
  action: string;
  resourceType: string;
};

export type GovernanceReport = {
  app: string;
  tables: GovernanceTable[];
  audit_event_shape: string[];
  audit_actions_seen: string[];
  approval_constraints: string[];
  app_role_grants: Record<string, string[]>;
  routes: GovernanceRoute[];
  routes_outside_registry: { method: string; path: string }[];
};

/** Scaffold tables whose grants are reported for every app, for comparability. */
const SHARED_TABLES = ["approval", "audit_event"];

async function tables(client: Queryable, names: string[]): Promise<GovernanceTable[]> {
  if (names.length === 0) return [];
  const rows = await client.query<{ name: string; pk: string | null; audit_trigger: boolean }>(
    `SELECT c.relname AS name,
            (
              SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
               WHERE i.indrelid = c.oid AND i.indisprimary
            ) AS pk,
            EXISTS (
              SELECT 1 FROM pg_trigger t
               WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                 AND t.tgfoid = 'audit_row'::regproc
            ) AS audit_trigger
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY ($1::text[])
      ORDER BY c.relname`,
    [names],
  );
  return rows.rows.map((row) => ({
    name: row.name,
    pk: row.pk ?? "none",
    audit_trigger: row.audit_trigger,
  }));
}

const auditEventShape = async (client: Queryable): Promise<string[]> =>
  (
    await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'audit_event'
        ORDER BY ordinal_position`,
    )
  ).rows.map((row) => row.column_name);

const auditActionsSeen = async (client: Queryable, app: string): Promise<string[]> =>
  (
    await client.query<{ action: string }>(
      "SELECT DISTINCT action FROM audit_event WHERE app = $1 ORDER BY action",
      [app],
    )
  ).rows.map((row) => row.action);

/** The CHECK constraints on approval plus the triggers that enforce identity on it. */
const approvalConstraints = async (client: Queryable): Promise<string[]> => {
  const rows = await client.query<{ name: string }>(
    `SELECT conname AS name FROM pg_constraint
      WHERE conrelid = 'approval'::regclass AND contype = 'c'
     UNION
     SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'approval'::regclass AND NOT tgisinternal AND tgname <> 'audit'
     ORDER BY name`,
  );
  return rows.rows.map((row) => row.name);
};

/**
 * app_role's privileges per table. Column-level grants (approval's UPDATE) do
 * not appear in role_table_grants, so both views are unioned — otherwise the
 * report would claim app_role cannot record a decision.
 */
async function appRoleGrants(
  client: Queryable,
  names: string[],
): Promise<Record<string, string[]>> {
  const rows = await client.query<{ table_name: string; privilege_type: string }>(
    `SELECT DISTINCT table_name, privilege_type FROM (
       SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_role' AND table_schema = 'public'
       UNION
       SELECT table_name, privilege_type FROM information_schema.column_privileges
        WHERE grantee = 'app_role' AND table_schema = 'public'
     ) g
      WHERE table_name = ANY ($1::text[])
      ORDER BY table_name, privilege_type`,
    [names],
  );
  const grants: Record<string, string[]> = {};
  for (const name of [...names].sort()) {
    const privileges = rows.rows
      .filter((row) => row.table_name === name)
      .map((row) => row.privilege_type);
    if (privileges.length > 0) grants[name] = privileges;
  }
  return grants;
}

export async function buildGovernanceReport(
  client: Queryable,
  server: ScaffoldServer,
): Promise<GovernanceReport> {
  const routes = server.registeredRoutes();
  const resourceTypes = [...new Set(routes.map((route) => route.resourceType))].sort();
  const appTables = await tables(client, resourceTypes);

  return {
    app: server.app,
    tables: appTables,
    audit_event_shape: await auditEventShape(client),
    audit_actions_seen: await auditActionsSeen(client, server.app),
    approval_constraints: await approvalConstraints(client),
    app_role_grants: await appRoleGrants(client, [
      ...SHARED_TABLES,
      ...appTables.map((table) => table.name),
    ]),
    routes: routes.map((route) => ({
      method: route.method,
      path: route.path,
      action: route.action,
      resourceType: route.resourceType,
    })),
    routes_outside_registry: server.routesOutsideRegistry(),
  };
}

export const serializeGovernanceReport = (report: GovernanceReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;
