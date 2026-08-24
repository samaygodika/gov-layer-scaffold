/**
 * Every query the KYC review queue makes, against the transaction route()
 * opened. Nothing here writes audit rows or checks permissions: audit is the
 * audit_row() trigger's job and authorization is route()'s.
 */
import type { Tx } from "@scaffold/core";

/**
 * The transaction route() opened. Only `query` is used, which is also what lets
 * a test drive these functions on its own rolled-back connection.
 */
export type Db = Pick<Tx, "query">;

export const RESOURCE_TYPE = "kyc_case";
export const PAGE_SIZE = 50;

export type RiskTier = "low" | "medium" | "high";
export type CaseStatus = "pending" | "approved" | "rejected";
export type Decision = "approved" | "rejected";

export const RISK_TIERS: RiskTier[] = ["low", "medium", "high"];
export const CASE_STATUSES: CaseStatus[] = ["pending", "approved", "rejected"];

export type KycCase = {
  id: string;
  subjectName: string;
  submittedAt: string;
  riskTier: RiskTier;
  documents: unknown;
  status: CaseStatus;
};

export type CaseFilters = {
  status?: CaseStatus;
  riskTier?: RiskTier;
};

export type CasePage = {
  cases: KycCase[];
  page: number;
  pageSize: number;
  total: number;
};

/** An approval on this case: pending while `decision` is null. */
export type CaseApproval = {
  id: string;
  requestedBy: string;
  requestedByEmail: string;
  requestedAt: string | null;
  decidedBy: string | null;
  decidedByEmail: string | null;
  decision: Decision | null;
  decidedAt: string | null;
  rationale: string | null;
};

export type AuditEntry = {
  id: string;
  occurredAt: string;
  actor: string;
  resourceType: string;
  resourceId: string | null;
  action: "insert" | "update" | "delete";
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

type CaseRow = {
  id: string;
  subject_name: string;
  submitted_at: Date;
  risk_tier: RiskTier;
  documents: unknown;
  status: CaseStatus;
};

const toCase = (row: CaseRow): KycCase => ({
  id: row.id,
  subjectName: row.subject_name,
  submittedAt: row.submitted_at.toISOString(),
  riskTier: row.risk_tier,
  documents: row.documents,
  status: row.status,
});

/**
 * One page of the queue, newest first, filtered in the database. The count runs
 * on the same filters in the same transaction, so `total` and `cases` agree.
 */
export async function listCases(
  tx: Db,
  filters: CaseFilters,
  page: number,
  pageSize: number = PAGE_SIZE,
): Promise<CasePage> {
  const where = `WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR risk_tier = $2)`;
  const values = [filters.status ?? null, filters.riskTier ?? null];

  const total = await tx.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM kyc_case ${where}`,
    values,
  );
  const rows = await tx.query<CaseRow>(
    `SELECT id, subject_name, submitted_at, risk_tier, documents, status
       FROM kyc_case ${where}
      ORDER BY submitted_at DESC, id DESC
      LIMIT $3 OFFSET $4`,
    [...values, pageSize, (page - 1) * pageSize],
  );

  return {
    cases: rows.rows.map(toCase),
    page,
    pageSize,
    total: Number(total.rows[0]?.total ?? "0"),
  };
}

export async function findCase(tx: Db, id: string): Promise<KycCase | null> {
  const found = await tx.query<CaseRow>(
    `SELECT id, subject_name, submitted_at, risk_tier, documents, status
       FROM kyc_case WHERE id = $1`,
    [id],
  );
  const row = found.rows[0];
  return row ? toCase(row) : null;
}

/**
 * The case's approvals, newest first. `requested_at` is not a column on
 * `approval` (a scaffold table this session does not change), so it is read
 * from the audit row the insert produced.
 */
export async function caseApprovals(tx: Db, caseId: string): Promise<CaseApproval[]> {
  const rows = await tx.query<{
    id: string;
    requested_by: string;
    requested_by_email: string;
    requested_at: Date | null;
    decided_by: string | null;
    decided_by_email: string | null;
    decision: Decision | null;
    decided_at: Date | null;
    rationale: string | null;
  }>(
    `SELECT a.id,
            a.requested_by,
            requester.email AS requested_by_email,
            (
              SELECT min(e.occurred_at) FROM audit_event e
               WHERE e.resource_type = 'approval' AND e.resource_id = a.id::text
                 AND e.action = 'insert'
            ) AS requested_at,
            a.decided_by,
            decider.email AS decided_by_email,
            a.decision,
            a.decided_at,
            a.rationale
       FROM approval a
       JOIN actor requester ON requester.id = a.requested_by
       LEFT JOIN actor decider ON decider.id = a.decided_by
      WHERE a.resource_type = $1 AND a.resource_id = $2
      ORDER BY a.decided_at DESC NULLS FIRST, a.id`,
    [RESOURCE_TYPE, caseId],
  );

  return rows.rows.map((row) => ({
    id: row.id,
    requestedBy: row.requested_by,
    requestedByEmail: row.requested_by_email,
    requestedAt: row.requested_at?.toISOString() ?? null,
    decidedBy: row.decided_by,
    decidedByEmail: row.decided_by_email,
    decision: row.decision,
    decidedAt: row.decided_at?.toISOString() ?? null,
    rationale: row.rationale,
  }));
}

export const pendingApproval = async (tx: Db, caseId: string): Promise<CaseApproval | null> =>
  (await caseApprovals(tx, caseId)).find((approval) => approval.decision === null) ?? null;

/**
 * The case's audit history: its own rows plus the rows of every approval on it,
 * because a decision is an `update` on `approval` (spec, audit_event notes).
 *
 * `occurred_at` defaults to the transaction timestamp, so the two rows a decision
 * writes carry the same instant and there is no real order between them. The
 * tie-break on (resource_type, action) is presentational — it puts the approval
 * before the case status it caused — and keeps the timeline stable across reads.
 */
export async function caseHistory(tx: Db, caseId: string): Promise<AuditEntry[]> {
  const rows = await tx.query<{
    id: string;
    occurred_at: Date;
    actor: string;
    resource_type: string;
    resource_id: string | null;
    action: "insert" | "update" | "delete";
    request_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `SELECT e.id, e.occurred_at, actor.email AS actor, e.resource_type, e.resource_id,
            e.action, e.request_id, e.before, e.after
       FROM audit_event e
       JOIN actor ON actor.id = e.actor_id
      WHERE (e.resource_type = $1 AND e.resource_id = $2)
         OR (e.resource_type = 'approval' AND e.resource_id IN (
               SELECT a.id::text FROM approval a
                WHERE a.resource_type = $1 AND a.resource_id = $2
            ))
      ORDER BY e.occurred_at, e.resource_type, e.action, e.id`,
    [RESOURCE_TYPE, caseId],
  );

  return rows.rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actor: row.actor,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    requestId: row.request_id,
    before: row.before,
    after: row.after,
  }));
}

/**
 * Opens a review on the case. `requested_by` is the session actor, never the
 * request body — approval_actor_matches() refuses anything else.
 */
export async function requestReview(tx: Db, caseId: string, actorId: string): Promise<string> {
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO approval (resource_type, resource_id, requested_by)
       VALUES ($1, $2, $3) RETURNING id`,
    [RESOURCE_TYPE, caseId, actorId],
  );
  return inserted.rows[0]!.id;
}

/**
 * Records the decision on a pending approval and follows it into the case's
 * status, in one transaction. `decided_by` is the session actor; whether the
 * decision is allowed at all — a second person, with a rationale — is the
 * database's answer, not this function's.
 */
export async function decide(
  tx: Db,
  approvalId: string,
  caseId: string,
  actorId: string,
  decision: Decision,
  rationale: string,
): Promise<void> {
  await tx.query(
    `UPDATE approval
        SET decided_by = $1, decision = $2, decided_at = now(), rationale = $3
      WHERE id = $4 AND decision IS NULL`,
    [actorId, decision, rationale, approvalId],
  );
  await tx.query("UPDATE kyc_case SET status = $1 WHERE id = $2", [decision, caseId]);
}
