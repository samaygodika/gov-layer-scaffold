/**
 * The KYC review queue's server. Every route is declared with the scaffold's
 * route(), which resolves the actor, opens the transaction with withActor() and
 * calls authorize() first; there is no other route registration here, and no
 * per-route permission check.
 *
 * The maker-checker rule is not implemented in this file. A decision is an
 * UPDATE on `approval` with `decided_by` set from the session actor, and the
 * database refuses it when the decider is the requester or the rationale is
 * missing. This server's only job around it is to surface that refusal.
 */
import { createServer, isAuthorized, type Action, type ScaffoldServer, type Tx } from "@scaffold/core";
import type { Actor } from "@scaffold/core";
import {
  CASE_STATUSES,
  PAGE_SIZE,
  RESOURCE_TYPE,
  RISK_TIERS,
  caseApprovals,
  caseHistory,
  decide,
  findCase,
  listCases,
  pendingApproval,
  requestReview,
  type CaseStatus,
  type Decision,
  type RiskTier,
} from "./cases.js";

export const APP = "kyc";

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Postgres codes for a rejected write: a CHECK constraint and a trigger's RAISE. */
const REJECTION_CODES = new Set(["23514", "P0001"]);

/**
 * Turns a database refusal into 409 with the database's own message. The rule
 * itself is never re-implemented here: if this translation were removed, the
 * write would still fail — it would just fail as a 500.
 */
function asRejection(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code && REJECTION_CODES.has(code)) {
    throw new HttpError(409, (error as Error).message);
  }
  throw error;
}

const queryValue = (query: unknown, name: string): string | undefined => {
  const value = (query as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
};

function oneOf<T extends string>(
  value: string | undefined,
  allowed: T[],
  name: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as string[]).includes(value)) {
    throw new HttpError(400, `${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function pageNumber(query: unknown): number {
  const raw = queryValue(query, "page");
  if (raw === undefined) return 1;
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) throw new HttpError(400, "page must be 1 or greater");
  return page;
}

/** What the detail screen renders buttons from: the same authorize() the routes use. */
async function capabilities(tx: Tx, actor: Actor): Promise<Record<Action, boolean>> {
  const actions: Action[] = ["read", "write", "approve"];
  const entries = await Promise.all(
    actions.map(async (action) => [action, await isAuthorized(tx, actor, action, RESOURCE_TYPE)] as const),
  );
  return Object.fromEntries(entries) as Record<Action, boolean>;
}

const requireCaseId = (params: unknown): string => {
  const id = (params as { id?: string }).id;
  if (!id) throw new HttpError(400, "case id is required");
  return id;
};

export function createApp(): ScaffoldServer {
  const server = createServer({ app: APP });

  server.route(
    { method: "GET", path: "/api/me", action: "read", resourceType: RESOURCE_TYPE },
    async ({ tx, actor }) => ({
      actor: {
        id: actor.id,
        externalSubject: actor.externalSubject,
        email: actor.email,
        groups: actor.groups,
      },
      can: await capabilities(tx, actor),
    }),
  );

  server.route(
    { method: "GET", path: "/api/cases", action: "read", resourceType: RESOURCE_TYPE },
    async ({ tx, query }) =>
      listCases(
        tx,
        {
          status: oneOf<CaseStatus>(queryValue(query, "status"), CASE_STATUSES, "status"),
          riskTier: oneOf<RiskTier>(queryValue(query, "riskTier"), RISK_TIERS, "riskTier"),
        },
        pageNumber(query),
        PAGE_SIZE,
      ),
  );

  server.route(
    { method: "GET", path: "/api/cases/:id", action: "read", resourceType: RESOURCE_TYPE },
    async ({ tx, params, actor }) => {
      const id = requireCaseId(params);
      const kycCase = await findCase(tx, id);
      if (!kycCase) throw new HttpError(404, `no kyc_case ${id}`);
      return {
        case: kycCase,
        approvals: await caseApprovals(tx, id),
        history: await caseHistory(tx, id),
        can: await capabilities(tx, actor),
      };
    },
  );

  // Opening a review is a write on the case: the reviewer who opens it is the
  // "maker", and the database will not let them also be the checker.
  server.route(
    {
      method: "POST",
      path: "/api/cases/:id/review-requests",
      action: "write",
      resourceType: RESOURCE_TYPE,
    },
    async ({ tx, params, actor, reply }) => {
      const id = requireCaseId(params);
      const kycCase = await findCase(tx, id);
      if (!kycCase) throw new HttpError(404, `no kyc_case ${id}`);
      if (kycCase.status !== "pending") {
        throw new HttpError(409, `kyc_case ${id} is already ${kycCase.status}`);
      }
      if (await pendingApproval(tx, id)) {
        throw new HttpError(409, `kyc_case ${id} already has a review awaiting a decision`);
      }
      const approvalId = await requestReview(tx, id, actor.id).catch(asRejection);
      reply.code(201);
      return { approvalId, requestedBy: actor.externalSubject };
    },
  );

  server.route(
    {
      method: "POST",
      path: "/api/cases/:id/decision",
      action: "approve",
      resourceType: RESOURCE_TYPE,
    },
    async ({ tx, params, body, actor }) => {
      const id = requireCaseId(params);
      const payload = (body ?? {}) as { decision?: string; rationale?: string };
      const decision = oneOf<Decision>(payload.decision, ["approved", "rejected"], "decision");
      if (!decision) throw new HttpError(400, "decision is required");
      const rationale = payload.rationale?.trim();
      if (!rationale) throw new HttpError(400, "rationale is required");

      const kycCase = await findCase(tx, id);
      if (!kycCase) throw new HttpError(404, `no kyc_case ${id}`);
      const pending = await pendingApproval(tx, id);
      if (!pending) {
        throw new HttpError(409, `kyc_case ${id} has no review awaiting a decision`);
      }

      // decided_by is the session actor. Self-approval, and a decision with no
      // rationale, are refused by the database, not by a check here.
      await decide(tx, pending.id, id, actor.id, decision, rationale).catch(asRejection);

      return {
        case: await findCase(tx, id),
        approval: (await caseApprovals(tx, id)).find((approval) => approval.id === pending.id),
      };
    },
  );

  return server;
}
