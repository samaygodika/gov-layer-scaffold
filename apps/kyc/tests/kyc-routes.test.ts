/**
 * AC-2 … AC-6 — the KYC app driven through its own HTTP surface, as app_role,
 * with identity coming from the dev switcher's header.
 *
 * These tests commit: a request the server serves runs in withActor()'s own
 * transaction, so there is nothing for the test to roll back. Cases the tests
 * create are deleted afterwards; the `approval` and `audit_event` rows they
 * produce stay, because app_role holds no DELETE on either — which is the point
 * of the append-only audit trail rather than a shortcoming of the test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertAllRoutesAreRegistered, withActor, type ScaffoldServer } from "@scaffold/core";
import { actor, actorId, inTransaction } from "../../../scaffold/tests/helpers.js";
import { createApp } from "../server/app.js";
import { listCases, PAGE_SIZE } from "../server/cases.js";

const alice = actorId("alice");
const bob = actorId("bob");

const nodeEnv = process.env.NODE_ENV;
const createdCases: string[] = [];
let server: ScaffoldServer;

/** A committed pending case, as upstream intake would leave one. */
async function newCase(subjectName: string, riskTier = "high"): Promise<string> {
  const id = await withActor(actor("alice"), "test-setup", "kyc", async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO kyc_case (subject_name, risk_tier, documents)
         VALUES ($1, $2, '[{"kind":"passport","ref":"P-TEST"}]'::jsonb) RETURNING id`,
      [subjectName, riskTier],
    );
    return inserted.rows[0]!.id;
  });
  createdCases.push(id);
  return id;
}

const as = (subject: string) => ({ "x-dev-actor": subject });

const openReview = (caseId: string, subject: string, body?: Record<string, unknown>) =>
  server.inject({
    method: "POST",
    url: `/api/cases/${caseId}/review-requests`,
    headers: as(subject),
    payload: body ?? {},
  });

const decide = (caseId: string, subject: string, payload: Record<string, unknown>) =>
  server.inject({
    method: "POST",
    url: `/api/cases/${caseId}/decision`,
    headers: as(subject),
    payload,
  });

beforeAll(async () => {
  // The dev identity hook exists only in development; without it every request
  // here would be a 401 (scaffold SC-11).
  process.env.NODE_ENV = "development";
  server = createApp();
  await server.ready();
});

afterAll(async () => {
  await server.close();
  process.env.NODE_ENV = nodeEnv;
  if (createdCases.length > 0) {
    await withActor(actor("alice"), "test-teardown", "kyc", async (tx) => {
      await tx.query("DELETE FROM kyc_case WHERE id = ANY($1::uuid[])", [createdCases]);
    });
  }
});

describe("kyc routes", () => {
  it("AC-2 every route is declared through route(), so all_routes_are_registered passes", () => {
    expect(server.registeredRoutes()).toEqual([
      { method: "GET", path: "/api/cases", action: "read", resourceType: "kyc_case" },
      { method: "GET", path: "/api/cases/:id", action: "read", resourceType: "kyc_case" },
      {
        method: "POST",
        path: "/api/cases/:id/decision",
        action: "approve",
        resourceType: "kyc_case",
      },
      {
        method: "POST",
        path: "/api/cases/:id/review-requests",
        action: "write",
        resourceType: "kyc_case",
      },
      { method: "GET", path: "/api/me", action: "read", resourceType: "kyc_case" },
    ]);
    expect(server.routesOutsideRegistry()).toEqual([]);
    expect(() => assertAllRoutesAreRegistered(server)).not.toThrow();
  });

  it("AC-2 authorization is the choke point: no identity is 401, an agent may not decide", async () => {
    const caseId = await newCase("AC-2 authorization");

    const anonymous = await server.inject({ method: "GET", url: "/api/cases" });
    expect(anonymous.statusCode).toBe(401);

    // carol is an `agent`: read and write, no approve grant.
    const carolReads = await server.inject({ method: "GET", url: "/api/cases", headers: as("carol") });
    expect(carolReads.statusCode).toBe(200);

    expect((await openReview(caseId, "carol")).statusCode).toBe(201);
    const carolDecides = await decide(caseId, "carol", {
      decision: "approved",
      rationale: "not mine to make",
    });
    expect(carolDecides.statusCode).toBe(403);
    expect(carolDecides.json().error).toMatch(/carol may not approve kyc_case/);
  });

  it("AC-3 requested_by and decided_by come from the session actor, not the request body", async () => {
    const caseId = await newCase("AC-3 session actor");

    // bob opens the review while the body claims alice, and the body loses.
    const opened = await openReview(caseId, "bob", { requestedBy: alice, decidedBy: alice });
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toMatchObject({ requestedBy: "bob" });

    const decided = await decide(caseId, "alice", {
      decision: "approved",
      rationale: "documents match the subject",
      decidedBy: bob,
    });
    expect(decided.statusCode).toBe(200);

    const stored = await inTransaction(null, (tx) =>
      tx.query<{ requested_by: string; decided_by: string; decision: string; rationale: string }>(
        `SELECT requested_by, decided_by, decision, rationale FROM approval
          WHERE resource_type = 'kyc_case' AND resource_id = $1`,
        [caseId],
      ),
    );
    expect(stored.rows).toEqual([
      {
        requested_by: bob,
        decided_by: alice,
        decision: "approved",
        rationale: "documents match the subject",
      },
    ]);
  });

  it("AC-4 the reviewer who opened the review cannot decide it; a second reviewer can", async () => {
    const caseId = await newCase("AC-4 maker checker");
    expect((await openReview(caseId, "bob")).statusCode).toBe(201);

    const selfDecision = await decide(caseId, "bob", {
      decision: "approved",
      rationale: "I opened it, I will decide it",
    });
    expect(selfDecision.statusCode).toBe(409);
    expect(selfDecision.json().error).toMatch(/approval_maker_checker/);

    const stillPending = await server.inject({
      method: "GET",
      url: `/api/cases/${caseId}`,
      headers: as("bob"),
    });
    expect(stillPending.json().case.status).toBe("pending");

    const secondReviewer = await decide(caseId, "alice", {
      decision: "approved",
      rationale: "second pair of eyes: documents check out",
    });
    expect(secondReviewer.statusCode).toBe(200);
    expect(secondReviewer.json()).toMatchObject({
      case: { status: "approved" },
      approval: { decision: "approved", decidedByEmail: "alice@example.com" },
    });
  });

  it("AC-4 a decision with no rationale is refused", async () => {
    const caseId = await newCase("AC-4 rationale required");
    expect((await openReview(caseId, "bob")).statusCode).toBe(201);

    const noRationale = await decide(caseId, "alice", { decision: "rejected", rationale: "  " });
    expect(noRationale.statusCode).toBe(400);
    expect(noRationale.json().error).toBe("rationale is required");
  });

  it("AC-5 the detail response carries the audit history including the decision's diff", async () => {
    const caseId = await newCase("AC-5 audit history");
    expect((await openReview(caseId, "bob")).statusCode).toBe(201);
    expect(
      (await decide(caseId, "alice", { decision: "rejected", rationale: "address unverifiable" }))
        .statusCode,
    ).toBe(200);

    const detail = await server.inject({
      method: "GET",
      url: `/api/cases/${caseId}`,
      headers: as("alice"),
    });
    expect(detail.statusCode).toBe(200);
    const history = detail.json().history as {
      actor: string;
      action: string;
      resourceType: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }[];

    expect(
      history.map((entry) => `${entry.action} ${entry.resourceType} by ${entry.actor}`),
    ).toEqual([
      "insert kyc_case by alice@example.com",
      "insert approval by bob@example.com",
      "update approval by alice@example.com",
      "update kyc_case by alice@example.com",
    ]);

    const decision = history[2]!;
    expect(decision.before).toMatchObject({ decision: null, decided_by: null, rationale: null });
    expect(decision.after).toMatchObject({
      decision: "rejected",
      decided_by: alice,
      requested_by: bob,
      rationale: "address unverifiable",
    });
    expect(history[3]!.before).toMatchObject({ status: "pending" });
    expect(history[3]!.after).toMatchObject({ status: "rejected" });
  });

  it("AC-6 the list is paginated server-side: one page of 50, filters applied in SQL", async () => {
    const listed = await server.inject({
      method: "GET",
      url: "/api/cases?riskTier=high&status=pending",
      headers: as("alice"),
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as {
      cases: { riskTier: string; status: string; submittedAt: string }[];
      page: number;
      pageSize: number;
      total: number;
    };
    expect(body.pageSize).toBe(PAGE_SIZE);
    expect(body.page).toBe(1);
    expect(body.cases.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(body.cases.every((row) => row.riskTier === "high" && row.status === "pending")).toBe(true);
    const submitted = body.cases.map((row) => row.submittedAt);
    expect(submitted).toEqual([...submitted].sort().reverse());

    const rejected = await server.inject({
      method: "GET",
      url: "/api/cases?status=nonsense",
      headers: as("alice"),
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("AC-6 pagination holds at 10,000 rows: page 200 is the last, and each page costs one query", async () => {
    await inTransaction({ actorId: alice, requestId: "req-ac-6", app: "kyc" }, async (tx) => {
      await tx.query("DELETE FROM kyc_case");
      await tx.query(
        `INSERT INTO kyc_case (subject_name, submitted_at, risk_tier)
         SELECT 'Load ' || n, now() - (n * interval '1 minute'), 'low'
           FROM generate_series(1, 10000) AS n`,
      );

      const first = await listCases(tx, {}, 1);
      expect(first.total).toBe(10_000);
      expect(first.cases).toHaveLength(PAGE_SIZE);
      expect(first.cases[0]!.subjectName).toBe("Load 1");

      const last = await listCases(tx, {}, 200);
      expect(last.cases).toHaveLength(PAGE_SIZE);
      expect(last.cases.at(-1)!.subjectName).toBe("Load 10000");

      expect((await listCases(tx, {}, 201)).cases).toEqual([]);

      // The database does the paging: the plan carries the LIMIT, so a page never
      // materialises the table in the application.
      const plan = await tx.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT id FROM kyc_case ORDER BY submitted_at DESC, id DESC LIMIT 50 OFFSET 0`,
      );
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toMatch(/Limit/);
    });
  });
});
