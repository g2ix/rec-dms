import Link from "next/link";
import { notFound } from "next/navigation";
import { PageLinks } from "@/components/reports/queue-table";
import { formatManila } from "@/lib/time";
import { AppError } from "@/server/errors";
import { loadReport, parseReportFilters, type ReportFilters } from "@/server/reports/query";
import { requireUser } from "@/server/session";

export const metadata = { title: "Reports" };

const REVIEW = [
  ["", "Any review type"],
  ["EXEMPT", "Exempt"],
  ["EXPEDITED", "Expedited"],
  ["FULL", "Full"],
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseReportFilters(params);
  const user = await requireUser();
  const report = await readReport(user.id, filters);
  const query = filterQuery(filters);
  return (
    <article className="rec-stack">
      <h1 className="title">Reports</h1>
      <p className="body rec-muted">Submissions, decisions, and turnaround from the day staff screening is completed.</p>
      <form className="rec-filters" method="get" action="/app/reports">
        <label className="rec-field">
          <span className="rec-field__label">From</span>
          <input className="rec-input" type="date" name="from" defaultValue={filters.from ?? ""} />
        </label>
        <label className="rec-field">
          <span className="rec-field__label">To</span>
          <input className="rec-input" type="date" name="to" defaultValue={filters.to ?? ""} />
        </label>
        <label className="rec-field">
          <span className="rec-field__label">Panel</span>
          <select className="rec-select" name="panel" defaultValue={filters.panelId ?? ""}>
            <option value="">All panels you can see</option>
            {report.panels.map((panel) => (
              <option key={panel.id} value={panel.id}>
                {panel.name}
              </option>
            ))}
          </select>
        </label>
        <label className="rec-field">
          <span className="rec-field__label">Review type</span>
          <select className="rec-select" name="reviewType" defaultValue={filters.reviewType ?? ""}>
            {REVIEW.map(([value, label]) => (
              <option key={value || "any"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="rec-field">
          <span className="rec-field__label">Status</span>
          <input className="rec-input" name="status" defaultValue={filters.status ?? ""} />
        </label>
        <label className="rec-field">
          <span className="rec-field__label">Submission type</span>
          <input className="rec-input" name="submission" defaultValue={filters.submissionType ?? ""} placeholder="INITIAL" />
        </label>
        {filters.step ? <input type="hidden" name="step" value={filters.step} /> : null}
        <div className="rec-actions">
          <button className="rec-btn rec-btn--primary" type="submit">
            <span>Apply filters</span>
          </button>
          <a className="rec-btn rec-btn--secondary" href={`/app/reports/export${query}`}>
            <span>Download CSV</span>
          </a>
        </div>
      </form>
      <section className="rec-stack">
        <h2 className="heading">{report.submissions} submissions</h2>
        {report.decisions.length === 0 ? <p className="body">No decision is recorded in this set.</p> : null}
        {report.decisions.length > 0 ? (
          <ul className="rec-methods">
            {report.decisions.map((row) => (
              <li key={row.outcome}>
                {row.count} {row.label}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Review type</th>
                <th scope="col">Limit</th>
                <th scope="col">Median</th>
                <th scope="col">90th percentile</th>
                <th scope="col">Within the limit</th>
              </tr>
            </thead>
            <tbody>
              {report.turnaround.map((row) => (
                <tr key={row.reviewType}>
                  <td>{row.reviewType === "EXPEDITED" ? "Expedited" : row.reviewType === "FULL" ? "Full" : "Exempt"}</td>
                  <td>{row.limitDays} days</td>
                  <td>{row.medianDays === null ? "—" : `${row.medianDays} days`}</td>
                  <td>{row.p90Days === null ? "—" : `${row.p90Days} days`}</td>
                  <td>{row.count === 0 ? "—" : `${row.withinLimit} of ${row.count}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {report.rows.length === 0 ? <p className="body">No submission matches these filters.</p> : null}
      {report.rows.length > 0 ? (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Protocol</th>
                <th scope="col">Panel</th>
                <th scope="col">Review</th>
                <th scope="col">Status</th>
                <th scope="col">Submitted</th>
                <th scope="col">Decision</th>
                <th scope="col">Days</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.versionId}>
                  <td>
                    <Link href={`/app/protocols/${row.protocolId}`}>{row.title}</Link>
                    <p className="code">{row.code ?? "Code not assigned"}</p>
                  </td>
                  <td>{row.panel || "—"}</td>
                  <td>{row.reviewType || "—"}</td>
                  <td>{row.status}</td>
                  <td>{row.submittedAt ? formatManila(row.submittedAt, "d MMM yyyy") : "—"}</td>
                  <td>{row.decision || "—"}</td>
                  <td>{row.days === null ? "—" : `${row.days}${row.within ? ` · ${row.within}` : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <PageLinks page={report.page} pages={report.pages} href={`/app/reports${query}`} />
    </article>
  );
}

async function readReport(userId: string, filters: ReportFilters) {
  try {
    return await loadReport(userId, filters);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
}

function filterQuery(filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.panelId) params.set("panel", filters.panelId);
  if (filters.reviewType) params.set("reviewType", filters.reviewType);
  if (filters.status) params.set("status", filters.status);
  if (filters.submissionType) params.set("submission", filters.submissionType);
  if (filters.step) params.set("step", filters.step);
  const text = params.toString();
  return text ? `?${text}` : "";
}
