/**
 * Two screens and the dev-mode actor switcher: the queue and one case. There is
 * no create screen — cases arrive from upstream.
 *
 * Every failure the server returns is rendered verbatim, because the point of
 * the prototype is that a refusal is visible: 401 no identity, 403 no
 * permission_grant, 409 the database rejecting a self-decision.
 */
import { useCallback, useEffect, useState } from "react";
import { ActorSwitcher } from "./ActorSwitcher";
import { CaseDetail } from "./CaseDetail";
import { CaseList, type ListFilters } from "./CaseList";
import {
  fetchCase,
  fetchCases,
  fetchMe,
  readDevActor,
  requestReview,
  submitDecision,
  type CaseDetail as CaseDetailPayload,
  type CasePage,
  type Decision,
  type Me,
} from "./api";

const caseIdFromHash = (): string | null => {
  const match = window.location.hash.match(/^#\/cases\/(.+)$/);
  return match?.[1] ?? null;
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [filters, setFilters] = useState<ListFilters>({ status: "", riskTier: "", page: 1 });
  const [page, setPage] = useState<CasePage | null>(null);
  const [detail, setDetail] = useState<CaseDetailPayload | null>(null);
  const [caseId, setCaseId] = useState<string | null>(caseIdFromHash());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = (): void => setCaseId(caseIdFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!readDevActor()) {
      setMe(null);
      setError("no dev actor selected — pick one in the top bar");
      return;
    }
    try {
      setMe(await fetchMe());
      if (caseId) setDetail(await fetchCase(caseId));
      else setPage(await fetchCases(filters));
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [caseId, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<string>): Promise<void> => {
    try {
      setNotice(await action());
      setError(null);
    } catch (failure) {
      setNotice(null);
      setError((failure as Error).message);
    }
    if (caseId) {
      await fetchCase(caseId).then(setDetail, () => undefined);
    }
  };

  const openCase = (id: string): void => {
    setNotice(null);
    setError(null);
    window.location.hash = `#/cases/${id}`;
  };

  return (
    <>
      <header>
        <h1>KYC review queue</h1>
        <ActorSwitcher
          me={me}
          onChange={() => {
            setNotice(null);
            void load();
          }}
        />
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        {caseId && detail ? (
          <CaseDetail
            detail={detail}
            onBack={() => {
              setDetail(null);
              setNotice(null);
              window.location.hash = "";
            }}
            onRequestReview={() =>
              void act(async () => {
                await requestReview(detail.case.id);
                return "review opened; a different reviewer must decide it";
              })
            }
            onDecide={(decision: Decision, rationale: string) =>
              void act(async () => {
                const decided = await submitDecision(detail.case.id, decision, rationale);
                return `case ${decided.case.status}`;
              })
            }
          />
        ) : (
          <CaseList page={page} filters={filters} onFilters={setFilters} onOpen={openCase} />
        )}
      </main>
    </>
  );
}
