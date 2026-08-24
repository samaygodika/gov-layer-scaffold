import { describe, expect, it } from "vitest";
import { actorId, expectFailure, expectRejected, inTransaction, setActor } from "./helpers.js";

const alice = actorId("alice");
const bob = actorId("bob");
const carol = actorId("carol");

const insertRequest = (tx: import("pg").Client, requestedBy: string) =>
  tx.query<{ id: string }>(
    `INSERT INTO approval (resource_type, resource_id, requested_by)
       VALUES ('kyc_case', gen_random_uuid()::text, $1) RETURNING id`,
    [requestedBy],
  );

describe("separation of duties", () => {
  it("SC-3 an approval decided by its own requester is rejected", async () => {
    const failure = await inTransaction({ actorId: alice, app: "kyc" }, (tx) =>
      expectFailure(
        tx.query(
          `INSERT INTO approval
             (resource_type, resource_id, requested_by, decided_by, decision, decided_at, rationale)
           VALUES ('kyc_case', gen_random_uuid()::text, $1, $1, 'approved', now(), 'looks fine')`,
          [alice],
        ),
      ),
    );
    expect(failure.constraint).toBe("approval_maker_checker");
  });

  it("SC-3 the same request decided by a second actor is accepted", async () => {
    await inTransaction({ actorId: bob, app: "kyc" }, async (tx) => {
      const inserted = await insertRequest(tx, bob);
      await setActor(tx, { actorId: alice, app: "kyc" });
      const decided = await tx.query(
        `UPDATE approval
            SET decided_by = $1, decision = 'approved', decided_at = now(), rationale = 'second pair of eyes'
          WHERE id = $2`,
        [alice, inserted.rows[0]!.id],
      );
      expect(decided.rowCount).toBe(1);
    });
  });

  it("SC-4 requested_by that is not the transaction actor is rejected", async () => {
    const failure = await inTransaction({ actorId: alice, app: "kyc" }, (tx) =>
      expectFailure(insertRequest(tx, bob)),
    );
    expect(failure.message).toMatch(/approval\.requested_by .* must equal app\.actor_id/);
  });

  it("SC-4 decided_by that is not the transaction actor is rejected", async () => {
    const failure = await inTransaction({ actorId: bob, app: "kyc" }, async (tx) => {
      const inserted = await insertRequest(tx, bob);
      return expectFailure(
        tx.query(
          `UPDATE approval
              SET decided_by = $1, decision = 'approved', decided_at = now(), rationale = 'not my call'
            WHERE id = $2`,
          [carol, inserted.rows[0]!.id],
        ),
      );
    });
    expect(failure.message).toMatch(/approval\.decided_by .* must equal app\.actor_id/);
  });

  it("SC-4 app_role can update only the decision columns of approval", async () => {
    const granted = await inTransaction({ actorId: alice, app: "kyc" }, (tx) =>
      tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_name = 'approval' AND privilege_type = 'UPDATE'
            AND grantee = 'app_role'
          ORDER BY column_name`,
      ),
    );
    expect(granted.rows.map((row) => row.column_name)).toEqual([
      "decided_at",
      "decided_by",
      "decision",
      "rationale",
    ]);
  });

  it("SC-4 an actor cannot launder a request onto a colleague and then decide it", async () => {
    const failure = await inTransaction({ actorId: alice, app: "kyc" }, async (tx) => {
      const inserted = await insertRequest(tx, alice);
      return expectFailure(
        tx.query("UPDATE approval SET requested_by = $1 WHERE id = $2", [
          bob,
          inserted.rows[0]!.id,
        ]),
      );
    });
    expect(failure.code).toBe("42501");
    expect(failure.message).toMatch(/permission denied for (table|column) .*approval/);
  });

  it("SC-4 a decided approval cannot be repointed at another resource", async () => {
    const failures = await inTransaction({ actorId: bob, app: "kyc" }, async (tx) => {
      const inserted = await insertRequest(tx, bob);
      const id = inserted.rows[0]!.id;
      await setActor(tx, { actorId: alice, app: "kyc" });
      await tx.query(
        `UPDATE approval
            SET decided_by = $1, decision = 'approved', decided_at = now(), rationale = 'fine'
          WHERE id = $2`,
        [alice, id],
      );
      return [
        await expectRejected(tx, "UPDATE approval SET resource_id = 'other-case' WHERE id = $1", [
          id,
        ]),
        await expectRejected(
          tx,
          "UPDATE approval SET resource_type = 'refund_request' WHERE id = $1",
          [id],
        ),
      ];
    });
    for (const failure of failures) {
      expect(failure.code).toBe("42501");
    }
  });

  it("SC-5 a decision without a rationale is rejected", async () => {
    const failure = await inTransaction({ actorId: bob, app: "kyc" }, async (tx) => {
      const inserted = await insertRequest(tx, bob);
      await setActor(tx, { actorId: alice, app: "kyc" });
      return expectFailure(
        tx.query(
          `UPDATE approval
              SET decided_by = $1, decision = 'approved', decided_at = now()
            WHERE id = $2`,
          [alice, inserted.rows[0]!.id],
        ),
      );
    });
    expect(failure.constraint).toBe("approval_decision_has_rationale");
  });

  it("SC-5 a rationale and decider without a decision is rejected", async () => {
    const failure = await inTransaction({ actorId: bob, app: "kyc" }, async (tx) => {
      const inserted = await insertRequest(tx, bob);
      await setActor(tx, { actorId: alice, app: "kyc" });
      return expectFailure(
        tx.query(
          `UPDATE approval
              SET decided_by = $1, decided_at = now(), rationale = 'no decision recorded'
            WHERE id = $2`,
          [alice, inserted.rows[0]!.id],
        ),
      );
    });
    expect(failure.constraint).toBe("approval_decision_has_decider");
  });
});
