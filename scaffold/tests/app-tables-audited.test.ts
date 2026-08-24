/**
 * SC-8. The passing case runs against the real database as app_role; the failing
 * case runs the same assertion over a row describing a trigger-less table,
 * because creating one needs DDL and no test here connects as scaffold_owner.
 * `npm run tamper-check` does the real-migration version of the failing case.
 */
import { describe, expect, it } from "vitest";
import {
  appTableAudits,
  assertAllAppTablesAreAudited,
  NON_APP_TABLES,
  unauditedTables,
} from "../src/checks.js";
import { connect } from "./helpers.js";

describe("all_app_tables_are_audited", () => {
  it("SC-8 every app table in public has the audit trigger", async () => {
    const client = await connect();
    try {
      const audits = await appTableAudits(client);
      expect(unauditedTables(audits)).toEqual([]);
      expect(() => assertAllAppTablesAreAudited(audits)).not.toThrow();
    } finally {
      await client.end();
    }
  });

  it("SC-8 the check looks at pg_trigger, and the scaffold's audited tables are found there", async () => {
    const client = await connect();
    try {
      const triggers = await client.query<{ table: string }>(
        `SELECT c.relname AS table FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND NOT t.tgisinternal
            AND t.tgfoid = 'audit_row'::regproc
          ORDER BY c.relname`,
      );
      // arrayContaining, not toEqual: an app session adds audited tables of its
      // own (kyc_case), and this test is about the scaffold's two. That no
      // *unaudited* table exists is the sibling test above.
      expect(triggers.rows.map((row) => row.table)).toEqual(
        expect.arrayContaining(["_scaffold_fixture", "approval"]),
      );
    } finally {
      await client.end();
    }
  });

  it("SC-8 the check ignores the scaffold's own tables and the migration ledger", () => {
    expect([...NON_APP_TABLES]).toEqual([
      "_scaffold_fixture",
      "actor",
      "approval",
      "audit_event",
      "permission_grant",
      "schema_migration",
    ]);
  });

  it("SC-8 the check fails when a table has no audit trigger", () => {
    const audits = [
      { table: "kyc_case", auditTrigger: false },
      { table: "refund_request", auditTrigger: true },
    ];
    expect(unauditedTables(audits)).toEqual(["kyc_case"]);
    expect(() => assertAllAppTablesAreAudited(audits)).toThrowError(
      /tables without the audit trigger: kyc_case/,
    );
  });
});
