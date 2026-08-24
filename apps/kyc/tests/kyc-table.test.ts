/**
 * AC-1 — the migration that creates kyc_case attaches the audit trigger and
 * grants app_role the DML it needs. Every connection here is app_role: what the
 * application can do is the only thing worth asserting.
 */
import { describe, expect, it } from "vitest";
import { appTableAudits, unauditedTables } from "@scaffold/core";
import { actorId, connect, inTransaction } from "../../../scaffold/tests/helpers.js";

const alice = actorId("alice");

const insertCase = (tx: import("pg").Client, riskTier = "high") =>
  tx.query<{ id: string }>(
    `INSERT INTO kyc_case (subject_name, risk_tier, documents)
       VALUES ('Test Subject', $1, '[{"kind":"passport","ref":"P-1"}]'::jsonb)
     RETURNING id`,
    [riskTier],
  );

describe("kyc_case", () => {
  it("AC-1 has the audit trigger, so all_app_tables_are_audited passes", async () => {
    const client = await connect();
    try {
      const audits = await appTableAudits(client);
      expect(audits).toEqual(expect.arrayContaining([{ table: "kyc_case", auditTrigger: true }]));
      expect(unauditedTables(audits)).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("AC-1 grants app_role exactly the DML the application needs", async () => {
    const client = await connect();
    try {
      const grants = await client.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_role' AND table_schema = 'public' AND table_name = 'kyc_case'
          ORDER BY privilege_type`,
      );
      expect(grants.rows.map((row) => row.privilege_type)).toEqual([
        "DELETE",
        "INSERT",
        "SELECT",
        "UPDATE",
      ]);
    } finally {
      await client.end();
    }
  });

  it("AC-1 a case update inside an actor transaction produces one audit_event with the diff", async () => {
    await inTransaction({ actorId: alice, requestId: "req-ac-1", app: "kyc" }, async (tx) => {
      const inserted = await insertCase(tx);
      const id = inserted.rows[0]!.id;
      await tx.query("UPDATE kyc_case SET status = 'approved' WHERE id = $1", [id]);

      const audited = await tx.query<{
        action: string;
        actor_id: string;
        app: string;
        request_id: string;
        before: { status: string } | null;
        after: { status: string } | null;
      }>(
        `SELECT action, actor_id, app, request_id, before, after
           FROM audit_event
          WHERE resource_type = 'kyc_case' AND resource_id = $1
          ORDER BY occurred_at, action`,
        [id],
      );

      const updates = audited.rows.filter((row) => row.action === "update");
      expect(updates).toHaveLength(1);
      expect(updates[0]!.before?.status).toBe("pending");
      expect(updates[0]!.after?.status).toBe("approved");
      expect(updates[0]).toMatchObject({ actor_id: alice, app: "kyc", request_id: "req-ac-1" });

      const inserts = audited.rows.filter((row) => row.action === "insert");
      expect(inserts).toHaveLength(1);
      expect(inserts[0]!.before).toBeNull();
      expect(inserts[0]!.after?.status).toBe("pending");
    });
  });

  it("AC-1 a case update with no actor in the transaction is refused by the trigger", async () => {
    await inTransaction(null, async (tx) => {
      await expect(
        tx.query("UPDATE kyc_case SET status = 'approved' WHERE status = 'pending'"),
      ).rejects.toThrow(/app\.actor_id is not set/);
    });
  });
});
