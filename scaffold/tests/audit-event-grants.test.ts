import { describe, expect, it } from "vitest";
import { actorId, connect, expectFailure, inTransaction } from "./helpers.js";

describe("audit_event is append-only for app_role", () => {
  it("SC-2 app_role cannot INSERT into audit_event", async () => {
    const failure = await inTransaction(null, (tx) =>
      expectFailure(
        tx.query(
          `INSERT INTO audit_event (actor_id, app, action, resource_type, resource_id)
             VALUES ($1, 'kyc', 'insert', '_scaffold_fixture', gen_random_uuid()::text)`,
          [actorId("alice")],
        ),
      ),
    );
    expect(failure.code).toBe("42501");
    expect(failure.message).toMatch(/permission denied for table audit_event/);
  });

  it("SC-2 app_role cannot UPDATE audit_event", async () => {
    const failure = await inTransaction(null, (tx) =>
      expectFailure(tx.query("UPDATE audit_event SET app = 'tampered'")),
    );
    expect(failure.code).toBe("42501");
    expect(failure.message).toMatch(/permission denied for table audit_event/);
  });

  it("SC-2 app_role cannot DELETE from audit_event", async () => {
    const failure = await inTransaction(null, (tx) =>
      expectFailure(tx.query("DELETE FROM audit_event")),
    );
    expect(failure.code).toBe("42501");
    expect(failure.message).toMatch(/permission denied for table audit_event/);
  });

  it("SC-2 app_role holds only SELECT on audit_event", async () => {
    const client = await connect();
    try {
      const grants = await client.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_role' AND table_name = 'audit_event'
          ORDER BY privilege_type`,
      );
      expect(grants.rows.map((row) => row.privilege_type)).toEqual(["SELECT"]);
    } finally {
      await client.end();
    }
  });
});
