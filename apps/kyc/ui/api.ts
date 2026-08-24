/**
 * The API the three screens read. Identity is the dev_actor cookie the switcher
 * sets; the server refuses a request without one, so a 401 means "pick an
 * actor" and a 403 means the actor has no permission_grant for the action.
 */
export const DEV_ACTOR_COOKIE = "dev_actor";

export type RiskTier = "low" | "medium" | "high";
export type CaseStatus = "pending" | "approved" | "rejected";
export type Decision = "approved" | "rejected";
export type Capability = "read" | "write" | "approve";

export type KycCase = {
  id: string;
  subjectName: string;
  submittedAt: string;
  riskTier: RiskTier;
  documents: unknown;
  status: CaseStatus;
};

export type CasePage = {
  cases: KycCase[];
  page: number;
  pageSize: number;
  total: number;
};

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

export type CaseDetail = {
  case: KycCase;
  approvals: CaseApproval[];
  history: AuditEntry[];
  can: Record<Capability, boolean>;
};

export type Me = {
  actor: { id: string; externalSubject: string; email: string; groups: string[] };
  can: Record<Capability, boolean>;
};

export const readDevActor = (): string | null => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${DEV_ACTOR_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

export const writeDevActor = (subject: string): void => {
  document.cookie = `${DEV_ACTOR_COOKIE}=${encodeURIComponent(subject)}; path=/`;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // content-type only when something is being sent: the framework rejects a
  // bodyless POST that claims to carry JSON.
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? response.statusText;
    throw new Error(message);
  }
  return payload as T;
}

export const fetchMe = (): Promise<Me> => request<Me>("/api/me");

export function fetchCases(filters: {
  status: CaseStatus | "";
  riskTier: RiskTier | "";
  page: number;
}): Promise<CasePage> {
  const query = new URLSearchParams({ page: String(filters.page) });
  if (filters.status) query.set("status", filters.status);
  if (filters.riskTier) query.set("riskTier", filters.riskTier);
  return request<CasePage>(`/api/cases?${query.toString()}`);
}

export const fetchCase = (id: string): Promise<CaseDetail> => request<CaseDetail>(`/api/cases/${id}`);

export const requestReview = (id: string): Promise<{ approvalId: string }> =>
  request<{ approvalId: string }>(`/api/cases/${id}/review-requests`, { method: "POST" });

export const submitDecision = (
  id: string,
  decision: Decision,
  rationale: string,
): Promise<{ case: KycCase }> =>
  request<{ case: KycCase }>(`/api/cases/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, rationale }),
  });
