import { createServer, isAuthorized, type ScaffoldServer } from "@scaffold/core";

const RESOURCE_TYPE = "refund_request";
const APPROVAL_THRESHOLD_CENTS = 10_000;
const PAGE_SIZE = 50;

type RefundRow = {
  id: string;
  transaction_ref: string;
  amount_cents: number;
  currency: string;
  reason: string;
  requested_at: string;
  status: "pending" | "approved" | "rejected";
};

type ApprovalRow = {
  id: string;
  resource_type: string;
  resource_id: string;
  requested_by: string;
  decided_by: string | null;
  decision: "approved" | "rejected" | null;
  decided_at: string | null;
  rationale: string | null;
};

type ApprovalDetailRow = ApprovalRow & {
  requested_by_subject: string;
  decided_by_subject: string | null;
};

type Body = Record<string, unknown>;

type HttpError = Error & { statusCode: number };

const httpError = (statusCode: number, message: string): HttpError =>
  Object.assign(new Error(message), { statusCode });

function translateDatabaseError(error: unknown): never {
  const pgError = error as { code?: string; constraint?: string; message?: string };
  const message = pgError.message ?? String(error);
  if (
    pgError.constraint === "approval_maker_checker" ||
    message.includes("refund_request approval required") ||
    message.includes("approval_actor_matches")
  ) {
    throw httpError(409, message);
  }
  if (
    pgError.code === "23514" ||
    pgError.code === "22P02" ||
    pgError.code === "22007" ||
    pgError.code === "22023"
  ) {
    throw httpError(400, message);
  }
  throw error;
}

async function withDatabaseErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return translateDatabaseError(error);
  }
}

const bodyOf = (body: unknown): Body => (body && typeof body === "object" ? (body as Body) : {});

const requiredText = (body: Body, field: string): string => {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(400, `${field} is required`);
  }
  return value.trim();
};

const refundId = (params: unknown): string => {
  const id = (params as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw httpError(400, "id must be a UUID");
  }
  return id;
};

const pageNumber = (query: unknown): number => {
  const value = (query as { page?: unknown } | undefined)?.page;
  if (value === undefined || value === "") return 1;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) throw httpError(400, "page must be a positive integer");
  return page;
};

const filtersOf = (query: unknown): { status?: string; currency?: string } => {
  const values = query as { status?: unknown; currency?: unknown } | undefined;
  const status = values?.status;
  const currency = values?.currency;
  if (status !== undefined && (typeof status !== "string" || !["pending", "approved", "rejected"].includes(status))) {
    throw httpError(400, "status must be pending, approved, or rejected");
  }
  if (currency !== undefined && (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency))) {
    throw httpError(400, "currency must be a three-letter code");
  }
  return {
    ...(typeof status === "string" ? { status } : {}),
    ...(typeof currency === "string" ? { currency: currency.toUpperCase() } : {}),
  };
};

export function createApp(): ScaffoldServer {
  const server = createServer({ app: "refunds" });

  server.route(
    { method: "GET", path: "/refunds", action: "read", resourceType: RESOURCE_TYPE },
    async ({ tx, query }) => {
      const page = pageNumber(query);
      const { status, currency } = filtersOf(query);
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (status) {
        values.push(status);
        clauses.push(`status = $${values.length}`);
      }
      if (currency) {
        values.push(currency);
        clauses.push(`currency = $${values.length}`);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const count = await tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM refund_request ${where}`,
        values,
      );
      values.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);
      const items = await tx.query<RefundRow>(
        `SELECT id, transaction_ref, amount_cents, currency, reason, requested_at, status
           FROM refund_request ${where}
          ORDER BY requested_at DESC, id DESC
          LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      return { items: items.rows, page, pageSize: PAGE_SIZE, total: Number(count.rows[0]?.total ?? 0) };
    },
  );

  server.route(
    { method: "POST", path: "/refunds", action: "write", resourceType: RESOURCE_TYPE },
    async ({ tx, body, reply }) =>
      withDatabaseErrors(async () => {
        const values = bodyOf(body);
        const transactionRef = requiredText(values, "transaction_ref");
        const reason = requiredText(values, "reason");
        const amount = values.amount_cents;
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
          throw httpError(400, "amount_cents must be a positive integer");
        }
        const currency = requiredText(values, "currency").toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw httpError(400, "currency must be a three-letter uppercase code");
        const inserted = await tx.query<RefundRow>(
          `INSERT INTO refund_request (transaction_ref, amount_cents, currency, reason)
           VALUES ($1, $2, $3, $4)
           RETURNING id, transaction_ref, amount_cents, currency, reason, requested_at, status`,
          [transactionRef, amount, currency, reason],
        );
        reply.code(201);
        return inserted.rows[0];
      }),
  );

  server.route(
    { method: "GET", path: "/refunds/:id", action: "read", resourceType: RESOURCE_TYPE },
    async ({ tx, params, actor }) => {
      const id = refundId(params);
      const found = await tx.query<RefundRow>(
        `SELECT id, transaction_ref, amount_cents, currency, reason, requested_at, status
           FROM refund_request WHERE id = $1`,
        [id],
      );
      const refund = found.rows[0];
      if (!refund) throw httpError(404, "refund request not found");
      const approvals = await tx.query<ApprovalDetailRow>(
        `SELECT p.id, p.resource_type, p.resource_id, p.requested_by, p.decided_by,
                p.decision, p.decided_at, p.rationale,
                requester.external_subject AS requested_by_subject,
                decider.external_subject AS decided_by_subject
           FROM approval p
           JOIN actor requester ON requester.id = p.requested_by
           LEFT JOIN actor decider ON decider.id = p.decided_by
          WHERE p.resource_type = $1 AND p.resource_id = $2
          ORDER BY p.id`,
        [RESOURCE_TYPE, id],
      );
      const approvalIds = approvals.rows.map((approval) => approval.id);
      const history = await tx.query<{
        id: string;
        occurred_at: string;
        actor_id: string;
        external_subject: string;
        email: string;
        action: string;
        resource_type: string;
        resource_id: string;
        before: unknown;
        after: unknown;
      }>(
        `SELECT e.id, e.occurred_at, e.actor_id, a.external_subject, a.email,
                e.action, e.resource_type, e.resource_id, e.before, e.after
           FROM audit_event e
           JOIN actor a ON a.id = e.actor_id
          WHERE (e.resource_type = $1 AND e.resource_id = $2)
             OR (e.resource_type = 'approval' AND e.resource_id = ANY($3::text[]))
          ORDER BY e.occurred_at ASC, e.id ASC`,
        [RESOURCE_TYPE, id, approvalIds],
      );
      return {
        refund,
        approvals: approvals.rows,
        auditHistory: history.rows.map((event) => ({
          id: event.id,
          occurredAt: event.occurred_at,
          actor: { id: event.actor_id, externalSubject: event.external_subject, email: event.email },
          action: event.action,
          resourceType: event.resource_type,
          resourceId: event.resource_id,
          before: event.before,
          after: event.after,
        })),
        capabilities: {
          write: await isAuthorized(tx, actor, "write", RESOURCE_TYPE),
          approve: await isAuthorized(tx, actor, "approve", RESOURCE_TYPE),
          requiresApproval: refund.amount_cents >= APPROVAL_THRESHOLD_CENTS,
        },
      };
    },
  );

  server.route(
    { method: "POST", path: "/refunds/:id/approvals", action: "write", resourceType: RESOURCE_TYPE },
    async ({ tx, params, actor, reply }) =>
      withDatabaseErrors(async () => {
        const id = refundId(params);
        const refund = await tx.query<{ id: string; status: string }>(
          "SELECT id, status FROM refund_request WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (!refund.rows[0]) throw httpError(404, "refund request not found");
        if (refund.rows[0].status !== "pending") {
          throw httpError(409, "refund request must be pending before requesting review");
        }
        const open = await tx.query("SELECT 1 FROM approval WHERE resource_type = $1 AND resource_id = $2 AND decision IS NULL", [
          RESOURCE_TYPE,
          id,
        ]);
        if (open.rowCount !== 0) throw httpError(409, "an undecided approval already exists for this refund request");
        const inserted = await tx.query<ApprovalRow>(
          `INSERT INTO approval (resource_type, resource_id, requested_by)
           VALUES ($1, $2, $3)
           RETURNING id, resource_type, resource_id, requested_by, decided_by, decision, decided_at, rationale`,
          [RESOURCE_TYPE, id, actor.id],
        );
        reply.code(201);
        return inserted.rows[0];
      }),
  );

  server.route(
    { method: "POST", path: "/refunds/:id/decision", action: "approve", resourceType: RESOURCE_TYPE },
    async ({ tx, params, body, actor }) =>
      withDatabaseErrors(async () => {
        const id = refundId(params);
        const values = bodyOf(body);
        const decision = values.decision;
        if (decision !== "approved" && decision !== "rejected") {
          throw httpError(400, "decision must be approved or rejected");
        }
        const rationale = requiredText(values, "rationale");
        const locked = await tx.query<RefundRow>(
          `SELECT id, transaction_ref, amount_cents, currency, reason, requested_at, status
             FROM refund_request WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!locked.rows[0]) throw httpError(404, "refund request not found");
        const open = await tx.query<{ id: string }>(
          `SELECT id FROM approval
            WHERE resource_type = $1 AND resource_id = $2 AND decision IS NULL
            ORDER BY id LIMIT 1`,
          [RESOURCE_TYPE, id],
        );
        if (!open.rows[0]) throw httpError(409, "no undecided approval exists for this refund request");
        const updated = await tx.query<ApprovalRow>(
          `UPDATE approval
              SET decided_by = $1, decision = $2, decided_at = now(), rationale = $3
            WHERE id = $4 AND decided_by IS NULL
          RETURNING id, resource_type, resource_id, requested_by, decided_by, decision, decided_at, rationale`,
          [actor.id, decision, rationale, open.rows[0].id],
        );
        if (!updated.rows[0]) throw httpError(409, "approval was already decided by another actor");
        const refund = await tx.query<RefundRow>(
          `UPDATE refund_request SET status = $1 WHERE id = $2
          RETURNING id, transaction_ref, amount_cents, currency, reason, requested_at, status`,
          [decision, id],
        );
        return { approval: updated.rows[0], refund: refund.rows[0] };
      }),
  );

  server.route(
    { method: "POST", path: "/refunds/:id/complete", action: "write", resourceType: RESOURCE_TYPE },
    async ({ tx, params }) =>
      withDatabaseErrors(async () => {
        const id = refundId(params);
        const current = await tx.query<RefundRow>(
          `SELECT id, transaction_ref, amount_cents, currency, reason, requested_at, status
             FROM refund_request WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!current.rows[0]) throw httpError(404, "refund request not found");
        if (current.rows[0].status !== "pending") {
          throw httpError(409, "refund request must be pending before completion");
        }
        const updated = await tx.query<RefundRow>(
          `UPDATE refund_request SET status = 'approved'
            WHERE id = $1
          RETURNING id, transaction_ref, amount_cents, currency, reason, requested_at, status`,
          [id],
        );
        if (!updated.rows[0]) throw httpError(404, "refund request not found");
        return updated.rows[0];
      }),
  );

  return server;
}
