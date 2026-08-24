import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appTableAudits,
  assertAllAppTablesAreAudited,
  assertAllRoutesAreRegistered,
} from "../../../scaffold/src/checks.js";
import { closeAppPool, withActor } from "../../../scaffold/src/with-actor.js";
import type { ScaffoldServer } from "../../../scaffold/src/server.js";
import { actor, connect } from "../../../scaffold/tests/helpers.js";
import { createApp } from "../server/app.js";

process.env.NODE_ENV = "development";

const alice = actor("alice");
const bob = actor("bob");
const carol = actor("carol");
let server: ScaffoldServer;

const request = (method: "GET" | "POST", url: string, subject: string, payload?: unknown) =>
  server.inject({
    method,
    url,
    headers: { "x-dev-actor": subject, ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });

const createRefund = async (subject: string, amount = 5000): Promise<string> => {
  const response = await request("POST", "/refunds", subject, {
    transaction_ref: `test-${subject}-${Date.now()}-${Math.random()}`,
    amount_cents: amount,
    currency: "USD",
    reason: "Test refund",
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
};

const requestReview = async (id: string, subject: string): Promise<void> => {
  const response = await request("POST", `/refunds/${id}/approvals`, subject);
  expect(response.statusCode).toBe(201);
};

beforeAll(async () => {
  server = createApp();
  await server.ready();
});

afterAll(async () => {
  await server.close();
  await closeAppPool();
});

describe("refunds dashboard", () => {
  it("AC-1 refund_request has the audit trigger and all app tables are audited", async () => {
    const client = await connect();
    try {
      const trigger = await client.query(
        `SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'refund_request'::regclass
            AND tgname = 'audit' AND NOT tgisinternal`,
      );
      expect(trigger.rowCount).toBe(1);
      assertAllAppTablesAreAudited(await appTableAudits(client));
    } finally {
      await client.end();
    }
  });

  it("AC-2 every refunds route is registered through route()", () => {
    expect(server.registeredRoutes()).toEqual([
      { method: "GET", path: "/refunds", action: "read", resourceType: "refund_request" },
      { method: "POST", path: "/refunds", action: "write", resourceType: "refund_request" },
      { method: "GET", path: "/refunds/:id", action: "read", resourceType: "refund_request" },
      {
        method: "POST",
        path: "/refunds/:id/approvals",
        action: "write",
        resourceType: "refund_request",
      },
      {
        method: "POST",
        path: "/refunds/:id/complete",
        action: "write",
        resourceType: "refund_request",
      },
      {
        method: "POST",
        path: "/refunds/:id/decision",
        action: "approve",
        resourceType: "refund_request",
      },
    ]);
    expect(() => assertAllRoutesAreRegistered(server)).not.toThrow();
  });

  it("AC-3 decision uses the session actor and ignores body identity fields", async () => {
    const id = await createRefund("bob");
    await requestReview(id, "bob");
    const response = await request("POST", `/refunds/${id}/decision`, "alice", {
      decision: "rejected",
      rationale: "The transaction does not qualify",
      requested_by: bob.id,
      decided_by: bob.id,
    });
    expect(response.statusCode).toBe(200);
    const client = await connect();
    try {
      const row = await client.query<{ requested_by: string; decided_by: string }>(
        `SELECT requested_by, decided_by FROM approval
          WHERE resource_type = 'refund_request' AND resource_id = $1`,
        [id],
      );
      expect(row.rows[0]).toEqual({ requested_by: bob.id, decided_by: alice.id });
    } finally {
      await client.end();
    }
  });

  it("AC-4 self-approval is refused by the database and a second actor can decide", async () => {
    const id = await createRefund("bob");
    await requestReview(id, "bob");
    const refused = await request("POST", `/refunds/${id}/decision`, "bob", {
      decision: "approved",
      rationale: "I reviewed my own request",
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/approval_maker_checker/);
    const unchanged = await withActor(alice, "ac4-check", "refunds", async (tx) => {
      const result = await tx.query<{ status: string; decision: string | null }>(
        `SELECT r.status, a.decision
           FROM refund_request r
           JOIN approval a ON a.resource_type = 'refund_request' AND a.resource_id = r.id::text
          WHERE r.id = $1`,
        [id],
      );
      return result.rows[0];
    });
    expect(unchanged).toEqual({ status: "pending", decision: null });
    const accepted = await request("POST", `/refunds/${id}/decision`, "alice", {
      decision: "approved",
      rationale: "A second reviewer approved the refund",
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().refund.status).toBe("approved");
  });

  it("AC-5 detail audit history includes the decision before/after diff", async () => {
    const id = await createRefund("bob");
    await requestReview(id, "bob");
    await request("POST", `/refunds/${id}/decision`, "alice", {
      decision: "rejected",
      rationale: "Insufficient documentation",
    });
    const detail = await request("GET", `/refunds/${id}`, "alice");
    expect(detail.statusCode).toBe(200);
    const history = detail.json().auditHistory as {
      resourceType: string;
      action: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }[];
    expect(history.some((event) =>
      event.resourceType === "approval" &&
      event.action === "update" &&
      event.before?.decision === null &&
      event.after?.decision === "rejected",
    )).toBe(true);
    expect(history.some((event) =>
      event.resourceType === "refund_request" &&
      event.action === "update" &&
      event.before?.status === "pending" &&
      event.after?.status === "rejected",
    )).toBe(true);
  });

  it("AC-6 list pagination is server-side and supports 10,000 rows", async () => {
    await withActor(alice, "ac6-load", "refunds", async (tx) => {
      const count = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM refund_request");
      const existing = Number(count.rows[0]?.count ?? 0);
      if (existing < 10_000) {
        await tx.query(
          `INSERT INTO refund_request (transaction_ref, amount_cents, currency, reason, requested_at)
           SELECT 'load-' || g, 5000 + (g % 15001),
                  CASE g % 3 WHEN 0 THEN 'USD' WHEN 1 THEN 'EUR' ELSE 'GBP' END,
                  'Pagination load test', now() - (g * interval '1 second')
             FROM generate_series($1::integer, $2::integer) AS g`,
          [existing + 1, 10_000],
        );
      }
    });
    const first = await request("GET", "/refunds?page=1", "alice");
    const deep = await request("GET", "/refunds?page=200", "alice");
    expect(first.statusCode).toBe(200);
    expect(deep.statusCode).toBe(200);
    const firstBody = first.json() as { items: { id: string; requested_at: string }[]; pageSize: number; total: number };
    const deepBody = deep.json() as { items: { id: string; requested_at: string }[]; page: number };
    expect(firstBody.pageSize).toBe(50);
    expect(firstBody.total).toBeGreaterThanOrEqual(10_000);
    expect(deepBody.page).toBe(200);
    expect(deepBody.items).toHaveLength(50);
    expect(new Set(deepBody.items.map((item) => item.id)).size).toBe(50);
    expect(new Date(firstBody.items[0]!.requested_at).getTime()).toBeGreaterThanOrEqual(
      new Date(firstBody.items[1]!.requested_at).getTime(),
    );
  });

  it("AC-4 threshold completion requires approval only at or above 10,000 cents", async () => {
    const small = await createRefund("bob", 9999);
    const completed = await request("POST", `/refunds/${small}/complete`, "bob");
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe("approved");

    const large = await createRefund("bob", 10_000);
    const refused = await request("POST", `/refunds/${large}/complete`, "bob");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/10000 cents/);
    await requestReview(large, "bob");
    const approved = await request("POST", `/refunds/${large}/decision`, "alice", {
      decision: "approved",
      rationale: "Approved by a second actor",
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().refund.status).toBe("approved");
  });

  it("AC-4 agents are denied the decision route and rationale is required", async () => {
    const id = await createRefund("bob");
    await requestReview(id, "bob");
    const denied = await request("POST", `/refunds/${id}/decision`, "carol", {
      decision: "approved",
      rationale: "Not authorized",
    });
    expect(denied.statusCode).toBe(403);
    const missing = await request("POST", `/refunds/${id}/decision`, "alice", {
      decision: "approved",
      rationale: " ",
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toMatch(/rationale is required/);
  });
});
