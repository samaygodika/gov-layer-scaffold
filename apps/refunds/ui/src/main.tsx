import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Refund = {
  id: string;
  transaction_ref: string;
  amount_cents: number;
  currency: string;
  reason: string;
  requested_at: string;
  status: "pending" | "approved" | "rejected";
};

type Approval = {
  id: string;
  requested_by: string;
  requested_by_subject: string;
  decided_by: string | null;
  decided_by_subject: string | null;
  decision: "approved" | "rejected" | null;
  decided_at: string | null;
  rationale: string | null;
};

type Detail = {
  refund: Refund;
  approvals: Approval[];
  auditHistory: {
    id: string;
    occurredAt: string;
    actor: { externalSubject: string; email: string };
    action: string;
    resourceType: string;
    before: unknown;
    after: unknown;
  }[];
  capabilities: { write: boolean; approve: boolean; requiresApproval: boolean };
};

const DEV_ACTOR_COOKIE = "dev_actor";
const formatMoney = (amount: number, currency: string): string =>
  `${currency} ${(amount / 100).toFixed(2)}`;
const formatTime = (value: string): string => new Date(value).toLocaleString();
const errorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

function TopBar({ onError }: { onError: (message: string) => void }) {
  const current = document.cookie.match(/(?:^|;\s*)dev_actor=([^;]+)/)?.[1];
  return (
    <header className="topbar">
      <a href="#/">Refunds dashboard</a>
      <nav>
        <a href="#/">Requests</a>
        <a href="#/create">New refund</a>
        <label>
          Dev actor{" "}
          <select
            defaultValue={current ? decodeURIComponent(current) : ""}
            onChange={(event) => {
              document.cookie = `${DEV_ACTOR_COOKIE}=${encodeURIComponent(event.target.value)}; path=/`;
              onError("");
              window.location.reload();
            }}
          >
            <option value="" disabled>Select actor</option>
            <option value="alice">alice</option>
            <option value="bob">bob</option>
            <option value="carol">carol</option>
          </select>
        </label>
      </nav>
    </header>
  );
}

function ListScreen({ onError }: { onError: (message: string) => void }) {
  const [items, setItems] = useState<Refund[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [currency, setCurrency] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set("status", status);
    if (currency) params.set("currency", currency);
    void api<{ items: Refund[]; total: number }>(`/refunds?${params}`)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
        onError("");
      })
      .catch((error: Error) => onError(error.message));
  }, [page, status, currency, onError]);
  const pages = Math.max(1, Math.ceil(total / 50));
  return (
    <main>
      <div className="page-heading">
        <div>
          <h1>Refund requests</h1>
          <p>{total} requests · newest first</p>
        </div>
        <a className="button primary" href="#/create">Create request</a>
      </div>
      <section className="filters">
        <label>
          Status
          <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          Currency
          <input value={currency} maxLength={3} placeholder="USD" onChange={(event) => { setPage(1); setCurrency(event.target.value.toUpperCase()); }} />
        </label>
      </section>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Transaction</th><th>Amount</th><th>Reason</th><th>Requested</th><th>Status</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} onClick={() => { window.location.hash = `#/refund/${item.id}`; }}>
                <td><strong>{item.transaction_ref}</strong></td>
                <td>{formatMoney(item.amount_cents, item.currency)}</td>
                <td>{item.reason}</td>
                <td>{formatTime(item.requested_at)}</td>
                <td><span className={`status ${item.status}`}>{item.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="empty">No refund requests found.</p>}
      </div>
      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button>
      </div>
    </main>
  );
}

function DetailScreen({ id, onError }: { id: string; onError: (message: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => void api<Detail>(`/refunds/${id}`).then(setDetail).catch((error: Error) => onError(error.message));
  useEffect(load, [id]);
  if (!detail) return <main><p>Loading request…</p></main>;
  const { refund, capabilities } = detail;
  const hasOpenApproval = detail.approvals.some((approval) => approval.decision === null);
  const mutate = async (path: string, body?: object) => {
    setBusy(true);
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      onError("");
      load();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main>
      <a className="back" href="#/">← All requests</a>
      <div className="page-heading"><div><h1>{refund.transaction_ref}</h1><p>{formatMoney(refund.amount_cents, refund.currency)} · <span className={`status ${refund.status}`}>{refund.status}</span></p></div></div>
      <section className="card fields">
        <div><span>Transaction reference</span><strong>{refund.transaction_ref}</strong></div>
        <div><span>Amount</span><strong>{formatMoney(refund.amount_cents, refund.currency)}</strong></div>
        <div><span>Currency</span><strong>{refund.currency}</strong></div>
        <div><span>Requested at</span><strong>{formatTime(refund.requested_at)}</strong></div>
        <div className="wide"><span>Reason</span><strong>{refund.reason}</strong></div>
      </section>
      <section className="card actions">
        <h2>Actions</h2>
        {capabilities.write && refund.status === "pending" && !hasOpenApproval && (
          <button disabled={busy} onClick={() => void mutate(`/refunds/${id}/approvals`)}>Request review</button>
        )}
        {capabilities.approve && refund.status === "pending" && hasOpenApproval && (
          <>
            <label className="rationale">Rationale required<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>
            <button disabled={busy || !rationale.trim()} onClick={() => void mutate(`/refunds/${id}/decision`, { decision: "approved", rationale })}>Approve</button>
            <button disabled={busy || !rationale.trim()} onClick={() => void mutate(`/refunds/${id}/decision`, { decision: "rejected", rationale })}>Reject</button>
          </>
        )}
        {capabilities.write && refund.status === "pending" && !capabilities.requiresApproval && !hasOpenApproval && (
          <button disabled={busy} onClick={() => void mutate(`/refunds/${id}/complete`)}>Complete</button>
        )}
        {!capabilities.write && !capabilities.approve && <p className="muted">You do not have permission to act on this request.</p>}
        {capabilities.requiresApproval && <p className="muted">Refunds of 10,000 cents or more require a second actor&apos;s approval.</p>}
      </section>
      <section className="card">
        <h2>Approval history</h2>
        {detail.approvals.length === 0 ? <p className="muted">No review requested.</p> : detail.approvals.map((approval) => <div className="approval" key={approval.id}><strong>{approval.decision ?? "review requested"}</strong><span>Requested by {approval.requested_by_subject}</span>{approval.decided_by_subject && <span>Decided by {approval.decided_by_subject}</span>}{approval.rationale && <p>{approval.rationale}</p>}</div>)}
      </section>
      <section className="card">
        <h2>Audit timeline</h2>
        <div className="timeline">
          {detail.auditHistory.map((event) => <article key={event.id}><div className="dot" /><div><strong>{event.action} · {event.resourceType}</strong><span>{event.actor.externalSubject} ({event.actor.email}) · {formatTime(event.occurredAt)}</span><pre>{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre></div></article>)}
        </div>
      </section>
    </main>
  );
}

function CreateScreen({ onError }: { onError: (message: string) => void }) {
  const [form, setForm] = useState({ transaction_ref: "", amount_cents: "", currency: "USD", reason: "" });
  const [busy, setBusy] = useState(false);
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await api<Refund>("/refunds", { method: "POST", body: JSON.stringify({ ...form, amount_cents: Number(form.amount_cents) }) });
      window.location.hash = `#/refund/${created.id}`;
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <main><a className="back" href="#/">← All requests</a><h1>New refund request</h1><form className="card form" onSubmit={submit}><label>Transaction reference<input required value={form.transaction_ref} onChange={(event) => update("transaction_ref", event.target.value)} /></label><label>Amount (cents)<input required type="number" min="1" value={form.amount_cents} onChange={(event) => update("amount_cents", event.target.value)} /></label><label>Currency<input required minLength={3} maxLength={3} value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} /></label><label>Reason<textarea required value={form.reason} onChange={(event) => update("reason", event.target.value)} /></label><button className="primary" disabled={busy}>Create request</button></form></main>;
}

function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const detailId = hash.match(/^#\/refund\/([^/]+)$/)?.[1];
  return <><TopBar onError={setError} />{error && <div className="error" role="alert">{error}</div>}{detailId ? <DetailScreen id={detailId} onError={setError} /> : hash === "#/create" ? <CreateScreen onError={setError} /> : <ListScreen onError={setError} />}</>;
}

createRoot(document.getElementById("root")!).render(<App />);
