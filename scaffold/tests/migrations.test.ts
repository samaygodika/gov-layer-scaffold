import { describe, expect, it } from "vitest";
import { migrationFilenames } from "../src/migrations.js";
import { connect } from "./helpers.js";

describe("migrations", () => {
  it("SC-1 every migration is applied and recorded in schema_migration", async () => {
    const client = await connect();
    try {
      const applied = await client.query<{ filename: string }>(
        "SELECT filename FROM schema_migration ORDER BY filename",
      );
      expect(applied.rows.map((row) => row.filename)).toEqual(await migrationFilenames());

      // A superset check, not an equality one: app sessions add their own tables
      // to this schema, and all_app_tables_are_audited is what constrains them.
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          "_scaffold_fixture",
          "actor",
          "approval",
          "audit_event",
          "permission_grant",
          "schema_migration",
        ]),
      );
    } finally {
      await client.end();
    }
  });

  it("SC-1 trigger functions are SECURITY DEFINER and owned by scaffold_owner", async () => {
    const client = await connect();
    try {
      const functions = await client.query<{ proname: string; owner: string; secdef: boolean }>(
        `SELECT p.proname, r.rolname AS owner, p.prosecdef AS secdef
           FROM pg_proc p
           JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.proname IN ('audit_row', 'approval_actor_matches')
          ORDER BY p.proname`,
      );
      expect(functions.rows).toEqual([
        { proname: "approval_actor_matches", owner: "scaffold_owner", secdef: true },
        { proname: "audit_row", owner: "scaffold_owner", secdef: true },
      ]);
    } finally {
      await client.end();
    }
  });
});
