import { describe, expect, it } from "vitest";
import { withActor } from "../src/with-actor.js";
import { actor, connect } from "./helpers.js";

const alice = actor("alice");

describe("withActor()", () => {
  it("SC-6 carries the actor, request id and app into the transaction", async () => {
    const settings = await withActor(alice, "req-with-actor", "scaffold", async (tx) => {
      const read = await tx.query<{ actor_id: string; request_id: string; name: string }>(
        `SELECT current_setting('app.actor_id') AS actor_id,
                current_setting('app.request_id') AS request_id,
                current_setting('app.name') AS name`,
      );
      return read.rows[0]!;
    });
    expect(settings).toEqual({
      actor_id: alice.id,
      request_id: "req-with-actor",
      name: "scaffold",
    });
  });

  it("SC-6 a mutation inside withActor() is committed and audited", async () => {
    const id = await withActor(alice, "req-with-actor-commit", "scaffold", async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        "INSERT INTO _scaffold_fixture (note) VALUES ('withActor') RETURNING id",
      );
      return inserted.rows[0]!.id;
    });

    const client = await connect();
    try {
      const audited = await client.query<{ actor_id: string; app: string; request_id: string }>(
        `SELECT actor_id, app, request_id FROM audit_event
          WHERE resource_type = '_scaffold_fixture' AND resource_id = $1 AND action = 'insert'`,
        [id],
      );
      expect(audited.rows).toEqual([
        { actor_id: alice.id, app: "scaffold", request_id: "req-with-actor-commit" },
      ]);
    } finally {
      await client.end();
    }

    await withActor(alice, "req-with-actor-cleanup", "scaffold", (tx) =>
      tx.query("DELETE FROM _scaffold_fixture WHERE id = $1", [id]),
    );
  });

  it("SC-6 rolls back and rethrows when the callback fails", async () => {
    const id = await withActor(alice, "req-rollback", "scaffold", async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        "INSERT INTO _scaffold_fixture (note) VALUES ('rolled back') RETURNING id",
      );
      throw Object.assign(new Error("handler failed"), { fixtureId: inserted.rows[0]!.id });
    }).then(
      () => undefined,
      (error: Error & { fixtureId: string }) => {
        expect(error.message).toBe("handler failed");
        return error.fixtureId;
      },
    );

    const client = await connect();
    try {
      const rows = await client.query("SELECT 1 FROM _scaffold_fixture WHERE id = $1", [id]);
      expect(rows.rowCount).toBe(0);
      const audited = await client.query(
        "SELECT 1 FROM audit_event WHERE resource_id = $1 AND resource_type = '_scaffold_fixture'",
        [id],
      );
      expect(audited.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});
