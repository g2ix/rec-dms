import Link from "next/link";
import { redirect } from "next/navigation";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { StatusBadge } from "@/components/ui/status-badge";
import { auditActionLabel, chainStatusLabel, changedFields, formatSeq } from "@/lib/audit-log";
import { formatManila } from "@/lib/time";
import { audit } from "@/server/audit";
import { assertCanViewAudit } from "@/server/audit/access";
import { listAuditEvents, parseAuditFilters, type AuditFilters } from "@/server/audit/query";
import { requireUser } from "@/server/session";

export const metadata = { title: "Audit log" };

function queryString(filters: AuditFilters, page?: number): string {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.action) params.set("action", filters.action);
  if (filters.entity) params.set("entity", filters.entity);
  if (filters.protocol) params.set("protocol", filters.protocol);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.simplified) params.set("simplified", "1");
  if (page && page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireUser();
  try {
    await assertCanViewAudit(actor.id);
  } catch {
    redirect("/app");
  }

  const filters = parseAuditFilters(await searchParams);
  const verifiedAt = new Date();
  const [chain, listed] = await Promise.all([audit.verifyChain(), listAuditEvents(filters)]);
  const status = chainStatusLabel(chain, formatManila(verifiedAt, "HH:mm"));
  const pages = Math.max(1, Math.ceil(listed.total / listed.pageSize));
  const page = listed.page;
  const filtered = Boolean(filters.actor || filters.action || filters.entity || filters.protocol || filters.from || filters.to);

  return (
    <article className="rec-stack">
      <h1 className="title">Audit log</h1>
      <p className="body rec-muted">
        Sign-ins, approvals, and the other recorded actions, in the order they were appended. The badge shows whether that chain still matches.
      </p>
      <p>
        <StatusBadge tone={status.tone} label={status.label} />
      </p>
      <form className="rec-filters" action="/admin/audit" method="get">
        <div className="rec-field">
          <label className="label" htmlFor="audit-actor">
            Actor
          </label>
          <input id="audit-actor" className="rec-input" name="actor" defaultValue={filters.actor ?? ""} />
        </div>
        <div className="rec-field">
          <label className="label" htmlFor="audit-action">
            Action
          </label>
          <input id="audit-action" className="rec-input" name="action" defaultValue={filters.action ?? ""} />
        </div>
        <div className="rec-field">
          <label className="label" htmlFor="audit-entity">
            Entity
          </label>
          <input id="audit-entity" className="rec-input" name="entity" defaultValue={filters.entity ?? ""} />
        </div>
        <div className="rec-field">
          <label className="label" htmlFor="audit-protocol">
            Protocol
          </label>
          <input
            id="audit-protocol"
            className="rec-input"
            name="protocol"
            defaultValue={filters.protocol ?? ""}
            placeholder="Code or id"
          />
        </div>
        <div className="rec-field">
          <label className="label" htmlFor="audit-from">
            From
          </label>
          <input id="audit-from" className="rec-input" type="date" name="from" defaultValue={filters.from ?? ""} />
        </div>
        <div className="rec-field">
          <label className="label" htmlFor="audit-to">
            To
          </label>
          <input id="audit-to" className="rec-input" type="date" name="to" defaultValue={filters.to ?? ""} />
        </div>
        <div className="rec-actions">
          <button className="rec-btn rec-btn--primary" type="submit">
            <span>Apply filters</span>
          </button>
          <Link className="rec-btn rec-btn--secondary" href={`/admin/audit/export${queryString(filters)}`}>
            <span>Export CSV</span>
          </Link>
          {filtered ? (
            <Link className="rec-btn rec-btn--ghost" href="/admin/audit">
              <span>Clear</span>
            </Link>
          ) : null}
        </div>
      </form>

      <p className="body-sm rec-muted">
        {listed.total === 0 ? "No events" : `${listed.total} event${listed.total === 1 ? "" : "s"}`}
      </p>
      <div className="rec-table-wrap">
        <table className="rec-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
              <th scope="col">Changed</th>
            </tr>
          </thead>
          <tbody>
            {listed.rows.length === 0 ? (
              <tr>
                <td colSpan={5}>No audit events match these filters.</td>
              </tr>
            ) : null}
            {listed.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <time dateTime={row.occurredAt.toISOString()}>{formatManila(row.occurredAt)}</time>
                  <p className="caption rec-muted code">#{formatSeq(row.seq)}</p>
                </td>
                <td>{row.actor?.displayName ?? "System"}</td>
                <td>
                  <span className="body">{auditActionLabel(row.action)}</span>
                  <p className="caption code">{row.action}</p>
                </td>
                <td>
                  <span className="code">{row.entityType}</span>
                  {row.protocolId ? <p className="caption code">{row.protocolId}</p> : null}
                </td>
                <td>
                  {changedFields(row.diff) ? (
                    <details>
                      <summary className="caption">{changedFields(row.diff)}</summary>
                      <pre className="code rec-audit-diff">{JSON.stringify(row.diff, null, 2)}</pre>
                    </details>
                  ) : (
                    <span className="caption rec-muted">No field changes</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="rec-actions" aria-label="Pagination">
        {page > 1 ? (
          <Link className="rec-btn rec-btn--secondary" href={`/admin/audit${queryString(filters, page - 1)}`}>
            <span>Previous</span>
          </Link>
        ) : null}
        <p className="body-sm">
          Page {page} of {pages}
        </p>
        {page < pages ? (
          <Link className="rec-btn rec-btn--secondary" href={`/admin/audit${queryString(filters, page + 1)}`}>
            <span>Next</span>
          </Link>
        ) : null}
      </nav>

      {listed.protocolId ? (
        <section className="rec-stack">
          <h2 className="heading">Protocol activity</h2>
          <p className="body-sm">
            {filters.simplified ? (
              <Link href={`/admin/audit${queryString({ ...filters, simplified: false })}`}>Full detail</Link>
            ) : (
              <Link href={`/admin/audit${queryString({ ...filters, simplified: true })}`}>Proponent view</Link>
            )}
          </p>
          <AuditTimeline protocolId={listed.protocolId} viewerUserId={null} simplified={filters.simplified} />
        </section>
      ) : null}
    </article>
  );
}
