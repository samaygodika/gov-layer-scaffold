import { describe, expect, it } from "vitest";
import { actorId, connect, expectFailure, inTransaction } from "./helpers.js";

const alice = actorId("alice");

type AuditRow = {
  actor_id: string;
  app: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  before: { note: string | null } | null;
  after: { note: string | null } | null;
  request_id: string | null;
};

const auditRowsFor = (tx: import("pg").Client, resourceId: string) =>
  tx.query<AuditRow>(
    `SELECT actor_id, app, action, resource_type, resource_id, before, after, request_id
       FROM audit_event
      WHERE resource_type = '_scaffold_fixture' AND resource_id = $1
      ORDER BY occurred_at, action`,
    [resourceId],
  );

describe("audit_row()", () => {
  it("SC-6 an UPDATE inside an actor transaction writes exactly one audit_event", async () => {
    await inTransaction({ actorId: alice, requestId: "req-sc6", app: "kyc" }, async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        "INSERT INTO _scaffold_fixture (note) VALUES ('before') RETURNING id",
      );
      const id = inserted.rows[0]!.id;
      await tx.query("UPDATE _scaffold_fixture SET note = 'after' WHERE id = $1", [id]);

      const events = await auditRowsFor(tx, id);
      const updates = events.rows.filter((row) => row.action === "update");
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        actor_id: alice,
        app: "kyc",
        action: "update",
        resource_type: "_scaffold_fixture",
        resource_id: id,
        request_id: "req-sc6",
      });
      expect(updates[0]!.before).toMatchObject({ id, note: "before" });
      expect(updates[0]!.after).toMatchObject({ id, note: "after" });

      const inserts = events.rows.filter((row) => row.action === "insert");
      expect(inserts).toHaveLength(1);
      expect(inserts[0]!.before).toBeNull();
      expect(inserts[0]!.after).toMatchObject({ id, note: "before" });
    });
  });

  it("SC-6 a DELETE writes one audit_event with before set and after null", async () => {
    await inTransaction({ actorId: alice, requestId: "req-sc6-delete", app: "kyc" }, async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        "INSERT INTO _scaffold_fixture (note) VALUES ('doomed') RETURNING id",
      );
      const id = inserted.rows[0]!.id;
      await tx.query("DELETE FROM _scaffold_fixture WHERE id = $1", [id]);

      const events = await auditRowsFor(tx, id);
      const deletes = events.rows.filter((row) => row.action === "delete");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.before).toMatchObject({ id, note: "doomed" });
      expect(deletes[0]!.after).toBeNull();
    });
  });

  it("SC-7 a mutation with no app.actor_id fails and changes no row", async () => {
    const seeded = await (async () => {
      const client = await connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_id', $1, true)", [alice]);
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO _scaffold_fixture (note) VALUES ('untouched') RETURNING id",
        );
        await client.query("COMMIT");
        return inserted.rows[0]!.id;
      } finally {
        await client.end();
      }
    })();

    const failure = await inTransaction(null, (tx) =>
      expectFailure(
        tx.query("UPDATE _scaffold_fixture SET note = 'tampered' WHERE id = $1", [seeded]),
      ),
    );
    expect(failure.message).toMatch(/app\.actor_id is not set/);

    const client = await connect();
    try {
      const row = await client.query<{ note: string }>(
        "SELECT note FROM _scaffold_fixture WHERE id = $1",
        [seeded],
      );
      expect(row.rows[0]!.note).toBe("untouched");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor_id', $1, true)", [alice]);
      await client.query("DELETE FROM _scaffold_fixture WHERE id = $1", [seeded]);
      await client.query("COMMIT");
    } finally {
      await client.end();
    }
  });
});
