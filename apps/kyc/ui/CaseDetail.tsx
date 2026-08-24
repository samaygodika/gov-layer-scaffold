/**
 * Screen 2 — the case. Every field, the approvals on it, the action buttons the
 * actor's grants allow, and the audit history as a timeline. The decision
 * buttons are rendered only when the server said this actor may `approve`; the
 * server refuses regardless of what is rendered.
 */
import { useState } from "react";
import type { AuditEntry, CaseApproval, CaseDetail as CaseDetailPayload, Decision } from "./api";

const time = (value: string | null): string => (value ? new Date(value).toLocaleString() : "—");

const fieldValue = (row: Record<string, unknown> | null, key: string): string =>
  row && key in row ? JSON.stringify(row[key]) : "—";

/**
 * One row per key the audit event mentions, marked when it changed. Two JSON
 * blobs side by side leave the reader to spot the difference, which for
 * `documents` means reading past a lot of unchanged text.
 */
function Diff({ entry }: { entry: AuditEntry }) {
  const keys = [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ];
  return (
    <table className="diff">
      <tbody>
        {keys.map((key) => {
          const before = fieldValue(entry.before, key);
          const after = fieldValue(entry.after, key);
          const changed = before !== after;
          return (
            <tr key={key} className={changed ? "changed" : undefined}>
              <th>{key}</th>
              <td>{before}</td>
              <td>{changed ? "→" : ""}</td>
              <td>{changed ? after : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Approvals({ approvals }: { approvals: CaseApproval[] }) {
  if (approvals.length === 0) return <p>no review has been opened on this case</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>requested by</th>
          <th>requested at</th>
          <th>decided by</th>
          <th>decision</th>
          <th>decided at</th>
          <th>rationale</th>
        </tr>
      </thead>
      <tbody>
        {approvals.map((approval) => (
          <tr key={approval.id}>
            <td>{approval.requestedByEmail}</td>
            <td>{time(approval.requestedAt)}</td>
            <td>{approval.decidedByEmail ?? "—"}</td>
            <td>{approval.decision ?? "awaiting a second reviewer"}</td>
            <td>{time(approval.decidedAt)}</td>
            <td>{approval.rationale ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CaseDetail({
  detail,
  onBack,
  onRequestReview,
  onDecide,
}: {
  detail: CaseDetailPayload;
  onBack: () => void;
  onRequestReview: () => void;
  onDecide: (decision: Decision, rationale: string) => void;
}) {
  const [rationale, setRationale] = useState("");
  const pending = detail.approvals.find((approval) => approval.decision === null);
  const decided = detail.case.status !== "pending";

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← queue
      </button>

      <h2>{detail.case.subjectName}</h2>
      <table>
        <tbody>
          <tr>
            <th>id</th>
            <td>{detail.case.id}</td>
          </tr>
          <tr>
            <th>submitted at</th>
            <td>{time(detail.case.submittedAt)}</td>
          </tr>
          <tr>
            <th>risk tier</th>
            <td>{detail.case.riskTier}</td>
          </tr>
          <tr>
            <th>status</th>
            <td>{detail.case.status}</td>
          </tr>
          <tr>
            <th>documents</th>
            <td>
              <pre>{JSON.stringify(detail.case.documents, null, 2)}</pre>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>approvals</h3>
      <Approvals approvals={detail.approvals} />

      {!decided && (
        <fieldset>
          <legend>decision</legend>
          {!pending && detail.can.write && (
            <button type="button" onClick={onRequestReview}>
              open a review
            </button>
          )}
          {!pending && !detail.can.write && <p>your groups may not open a review on this case</p>}
          {pending && detail.can.approve && (
            <div>
              <p>
                opened by {pending.requestedByEmail}. A decision must come from a different
                reviewer — the database rejects a self-decision.
              </p>
              <label>
                rationale (required){" "}
                <input
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  size={60}
                />
              </label>
              {rationale.trim() === "" && (
                <p className="hint">a rationale is required before a decision can be recorded</p>
              )}
              <p>
                {(["approved", "rejected"] as Decision[]).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={rationale.trim() === ""}
                    onClick={() => onDecide(decision, rationale)}
                  >
                    {decision === "approved" ? "approve" : "reject"}
                  </button>
                ))}
              </p>
            </div>
          )}
          {pending && !detail.can.approve && <p>your groups may not decide this case</p>}
        </fieldset>
      )}

      <h3>audit history</h3>
      <ul className="timeline">
        {detail.history.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{time(entry.occurredAt)}</strong> — {entry.actor} — {entry.action}{" "}
              {entry.resourceType} {entry.requestId ? `(request ${entry.requestId})` : ""}
            </div>
            <Diff entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}
