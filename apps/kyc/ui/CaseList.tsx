/**
 * Screen 1 — the queue. Filters and paging are query parameters the server
 * applies in SQL; this component never filters a full table client-side.
 */
import type { CasePage, CaseStatus, RiskTier } from "./api";

export type ListFilters = { status: CaseStatus | ""; riskTier: RiskTier | ""; page: number };

export function CaseList({
  page,
  filters,
  onFilters,
  onOpen,
}: {
  page: CasePage | null;
  filters: ListFilters;
  onFilters: (filters: ListFilters) => void;
  onOpen: (id: string) => void;
}) {
  const pageCount = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <section>
      <fieldset>
        <legend>filters</legend>
        <label>
          status{" "}
          <select
            value={filters.status}
            onChange={(event) =>
              onFilters({ ...filters, status: event.target.value as CaseStatus | "", page: 1 })
            }
          >
            <option value="">any</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
        </label>{" "}
        <label>
          risk tier{" "}
          <select
            value={filters.riskTier}
            onChange={(event) =>
              onFilters({ ...filters, riskTier: event.target.value as RiskTier | "", page: 1 })
            }
          >
            <option value="">any</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </fieldset>

      <table>
        <thead>
          <tr>
            <th>subject</th>
            <th>submitted</th>
            <th>risk tier</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {page?.cases.map((kycCase) => (
            <tr key={kycCase.id} onClick={() => onOpen(kycCase.id)}>
              <td>{kycCase.subjectName}</td>
              <td>{new Date(kycCase.submittedAt).toLocaleString()}</td>
              <td>{kycCase.riskTier}</td>
              <td>{kycCase.status}</td>
            </tr>
          ))}
          {page?.cases.length === 0 && (
            <tr>
              <td colSpan={4}>no cases match these filters</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="pagination">
        <button
          type="button"
          disabled={filters.page <= 1}
          onClick={() => onFilters({ ...filters, page: filters.page - 1 })}
        >
          previous
        </button>
        <span>
          page {page?.page ?? filters.page} of {pageCount} — {page?.total ?? 0} cases, {page?.pageSize ?? 0} per page
        </span>
        <button
          type="button"
          disabled={filters.page >= pageCount}
          onClick={() => onFilters({ ...filters, page: filters.page + 1 })}
        >
          next
        </button>
      </div>
    </section>
  );
}
