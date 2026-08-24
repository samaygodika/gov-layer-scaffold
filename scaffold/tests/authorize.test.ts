import { describe, expect, it } from "vitest";
import { AuthorizationError, authorize, isAuthorized } from "../src/authorize.js";
import { actor, inTransaction } from "./helpers.js";

const alice = actor("alice"); // reviewer: read, write, approve
const carol = actor("carol"); // agent: read, write — never approve

describe("authorize()", () => {
  it("SC-9 denies when no permission_grant matches the actor's groups", async () => {
    await inTransaction(null, async (tx) => {
      await expect(authorize(tx, carol, "approve", "_scaffold_fixture")).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(isAuthorized(tx, carol, "approve", "_scaffold_fixture")).resolves.toBe(false);
    });
  });

  it("SC-9 denies an unknown resource type, an actor with no groups, and an inactive actor", async () => {
    await inTransaction(null, async (tx) => {
      await expect(isAuthorized(tx, alice, "read", "not_a_resource")).resolves.toBe(false);
      await expect(isAuthorized(tx, { ...alice, groups: [] }, "read", "_scaffold_fixture")).resolves.toBe(
        false,
      );
      await expect(
        isAuthorized(tx, { ...alice, active: false }, "read", "_scaffold_fixture"),
      ).resolves.toBe(false);
    });
  });

  it("SC-9 allows exactly the actions the actor's groups are granted", async () => {
    await inTransaction(null, async (tx) => {
      for (const action of ["read", "write", "approve"] as const) {
        await expect(isAuthorized(tx, alice, action, "_scaffold_fixture")).resolves.toBe(true);
      }
      await expect(isAuthorized(tx, carol, "read", "_scaffold_fixture")).resolves.toBe(true);
      await expect(isAuthorized(tx, carol, "write", "_scaffold_fixture")).resolves.toBe(true);
    });
  });

  it("SC-9 names the actor, action and resource in the denial", async () => {
    const denial = await inTransaction(null, (tx) =>
      authorize(tx, carol, "approve", "_scaffold_fixture").then(
        () => null,
        (error: Error) => error,
      ),
    );
    expect(denial?.message).toBe(
      "actor carol may not approve _scaffold_fixture: no permission_grant for groups [agent]",
    );
  });
});
