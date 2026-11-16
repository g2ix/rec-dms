import Link from "next/link";
import { protocolTone } from "@/components/reports/queue-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { daysLeftPhrase } from "@/lib/dashboard/proponent";
import type { TurnaroundSummary } from "@/lib/reports/metrics";
import { formatManila } from "@/lib/time";
import type { DashboardModel, LoadRow, StepCount } from "@/server/reports/dashboard";
import type { QueueRow } from "@/server/reports/rows";

/**
 * Dashboards for every role except the proponent, who has a dashboard of their own.
 * Every role gets the same frame: the date, a strip of counts that each link to the list
 * they count, the work waiting on this person, and a side column for context.
 */

type RoleModel = Exclude<DashboardModel, { view: "proponent" }>;
type Tone = "warning" | "danger" | null;

const REVIEW_WORD: Record<string, string> = {
  EXEMPT: "Exempt",
  EXPEDITED: "Expedited",
  FULL: "Full",
};

const ROLE_LINE: Record<RoleModel["view"], string> = {
  adviser: "Adviser",
  reviewer: "Reviewer",
  "panel-chair": "Panel Chair",
  staff: "REC Staff",
  chair: "REC Chair",
};

export function DashboardView({ model, now = new Date() }: { model: DashboardModel; now?: Date }) {
  if (model.view === "proponent") return null;
  const sub = model.view === "panel-chair" ? `${ROLE_LINE[model.view]} · ${model.panelLabel}` : ROLE_LINE[model.view];
  return (
    <article className="rec-dash">
      <header className="rec-dash-head">
        <div>
          <p className="rec-dash-date">{formatManila(now, "EEEE, d MMMM yyyy")}</p>
          <h1 className="title">Dashboard</h1>
          <p className="body-sm rec-muted">{sub}</p>
        </div>
      </header>
      <RoleBody model={model} now={now} />
    </article>
  );
}

function RoleBody({ model, now }: { model: RoleModel; now: Date }) {
  if (model.view === "adviser") {
    return (
      <>
        <Strip
          cells={[
            waitingCell(model.waiting, "/app/tasks", "Waiting for you", "Signatures and F-38 reviews the REC needs from you", now),
            {
              href: "/app/advised",
              count: model.protocols.total,
              label: "Protocols you advise",
              detail: model.protocols.rows[0] ? `Latest update: ${rowName(model.protocols.rows[0])}` : "None yet",
            },
          ]}
        />
        <div className="rec-dash__grid">
          <div className="rec-dash__main">
            <WorkCard
              title="Waiting for your signature or review"
              href="/app/tasks"
              bucket={model.waiting}
              empty="Nothing is waiting for you. Signature requests and F-38 reviews will show up here."
              action="Open task"
              now={now}
            />
          </div>
          <aside className="rec-dash__side">
            <ProtocolCard title="Protocols you advise" href="/app/advised" bucket={model.protocols} empty="You are not advising a protocol yet." />
          </aside>
        </div>
      </>
    );
  }

  if (model.view === "reviewer") {
    return (
      <>
        <Strip
          cells={[
            waitingCell(model.open, "/app/reviews", "Assigned reviews", "Reviews assigned to you", now),
            {
              href: "/app/reviews#completed",
              count: model.completed.total,
              label: "Completed reviews",
              detail: model.completed.rows[0] ? `Last: ${rowName(model.completed.rows[0])}` : "Assessments you have submitted",
            },
          ]}
        />
        <div className="rec-dash__grid">
          <div className="rec-dash__main">
            <WorkCard
              title="Assigned to you"
              href="/app/reviews"
              bucket={model.open}
              empty="No review is assigned to you. New assignments will show up here."
              action="Open review"
              now={now}
            />
          </div>
          <aside className="rec-dash__side">
            <ProtocolCard
              title="Recently completed"
              href="/app/reviews#completed"
              bucket={model.completed}
              empty="You have not completed a review yet."
            />
          </aside>
        </div>
      </>
    );
  }

  if (model.view === "panel-chair") {
    const open = model.steps.reduce((sum, row) => sum + row.count, 0);
    const assessments = model.loads.reduce((sum, row) => sum + row.open, 0);
    return (
      <>
        <Strip
          cells={[
            waitingCell(model.waiting, "/app/decisions", "Decisions waiting", "Decisions the panel needs from you", now),
            overdueCell(model.overdue.total, model.overdue.rows, "/app/overdue", "Overdue in your panel", now),
            {
              href: "/app/panel",
              count: open,
              label: "Open protocols",
              detail: open === 0 ? "Nothing open in your panel" : plural(new Set(model.steps.map((row) => row.key)).size, "step"),
            },
            {
              href: "/app/reviewers",
              count: model.loads.length,
              label: "Reviewers with open work",
              detail: model.loads.length === 0 ? "No open assessments" : `${plural(assessments, "open assessment")}`,
            },
          ]}
        />
        <div className="rec-dash__grid">
          <div className="rec-dash__main">
            <WorkCard
              title="Decisions waiting"
              href="/app/decisions"
              bucket={model.waiting}
              empty="No decision is waiting. Protocols ready for your decision will show up here."
              action="Open decision"
              now={now}
            />
            <WorkCard
              title="Overdue in your panel"
              href="/app/overdue"
              bucket={model.overdue}
              empty="Nothing in your panel is overdue."
              action="Open task"
              now={now}
            />
          </div>
          <aside className="rec-dash__side">
            <StepCard title="Protocols by step" rows={model.steps} empty="No protocol is open in your panel." />
            <LoadCard rows={model.loads} />
          </aside>
        </div>
      </>
    );
  }

  if (model.view === "staff") {
    return (
      <>
        <Strip
          cells={[
            waitingCell(model.waiting, "/app/tasks", "Your inbox", "Tasks assigned to you", now),
            {
              href: "/app/screening",
              count: model.screening.total,
              label: "Screening queue",
              detail: model.screening.rows[0] ? `Oldest: ${rowName(model.screening.rows[0])}` : "Nothing to screen",
            },
            {
              href: "/app/releases",
              count: model.releases.total,
              label: "Decisions to release",
              detail: model.releases.rows[0] ? `Oldest: ${rowName(model.releases.rows[0])}` : "Nothing to release",
            },
            overdueCell(model.overdue.total, model.overdue.rows, "/app/overdue", "Overdue tasks", now),
          ]}
        />
        <div className="rec-dash__grid">
          <div className="rec-dash__main">
            <WorkCard title="Your inbox" href="/app/tasks" bucket={model.waiting} empty="Your inbox is clear." action="Open task" now={now} />
            <WorkCard
              title="Screening queue"
              href="/app/screening"
              bucket={model.screening}
              empty="The screening queue is empty."
              action="Screen"
              now={now}
            />
            <WorkCard
              title="Decisions to release"
              href="/app/releases"
              bucket={model.releases}
              empty="No decision is waiting to be released."
              action="Open release"
              now={now}
            />
          </div>
          <aside className="rec-dash__side">
            <section className="rec-card rec-dash-card">
              <h2 className="heading">Also waiting</h2>
              <ul className="rec-tally">
                <CountItem href="/app/receipts" count={model.receipts} label="Fee receipts to verify" />
                <CountItem href="/app/users" count={model.pendingUsers} label="Accounts waiting for approval" />
              </ul>
            </section>
            <ProtocolCard title="Overdue" href="/app/overdue" bucket={model.overdue} empty="Nothing is overdue." now={now} />
          </aside>
        </div>
      </>
    );
  }

  const inReview = model.pipeline.reduce((sum, row) => sum + row.count, 0);
  const measured = model.turnaround.reduce((sum, row) => sum + row.count, 0);
  const within = model.turnaround.reduce((sum, row) => sum + row.withinLimit, 0);
  return (
    <>
      <Strip
        cells={[
          waitingCell(model.waiting, "/app/tasks", "Your inbox", "Tasks assigned to you", now),
          {
            href: "/app/overdue",
            count: model.overdue,
            label: "Overdue tasks",
            detail: model.overdue === 0 ? "Nothing is overdue" : "Across the committee",
            tone: model.overdue > 0 ? "danger" : null,
          },
          {
            href: "/app/reports",
            count: inReview,
            label: "Protocols in review",
            detail: inReview === 0 ? "Nothing is in review" : plural(new Set(model.pipeline.map((row) => row.key)).size, "step"),
          },
          {
            href: "/app/reports",
            count: within,
            label: "Decided within the limit",
            detail: measured === 0 ? "No decision measured yet" : `of ${measured} measured from complete documents`,
            tone: measured > 0 && within < measured ? "warning" : null,
          },
        ]}
      />
      <div className="rec-dash__grid">
        <div className="rec-dash__main">
          <WorkCard title="Your inbox" href="/app/tasks" bucket={model.waiting} empty="Your inbox is clear." action="Open task" now={now} />
          <section className="rec-card rec-dash-card">
            <div className="rec-dash-card__head">
              <h2 className="heading">Turnaround from complete documents</h2>
              <Link className="rec-link" href="/app/reports">
                Open reports
              </Link>
            </div>
            <TurnaroundTable rows={model.turnaround} />
          </section>
        </div>
        <aside className="rec-dash__side">
          <StepCard title="Pipeline" rows={model.pipeline} empty="No protocol is in review." />
        </aside>
      </div>
    </>
  );
}

/** `tone` colors the count itself (it counts a problem); `detailTone` colors only the detail line. */
type Cell = { href: string; count: number; label: string; detail: string; tone?: Tone; detailTone?: Tone };

function Strip({ cells }: { cells: Cell[] }) {
  return (
    <section className={`rec-strip rec-strip--${cells.length}`} aria-label="Summary">
      {cells.map((cell) => {
        const detailTone = cell.count > 0 ? (cell.detailTone ?? cell.tone ?? null) : null;
        return (
        <Link key={cell.label} className="rec-strip__cell" href={cell.href}>
          <p className={statClass(cell.count, cell.tone ?? null)}>{cell.count}</p>
          <p className="rec-strip__label">{cell.label}</p>
          <p className={detailTone ? `rec-strip__detail rec-tone rec-tone--${detailTone}` : "rec-strip__detail"}>
            {cell.detail}
          </p>
        </Link>
        );
      })}
    </section>
  );
}

function waitingCell(bucket: Bucket, href: string, label: string, idle: string, now: Date): Cell {
  if (bucket.total === 0) return { href, count: 0, label, detail: idle };
  const next = bucket.rows.find((row) => row.dueAt);
  if (!next?.dueAt) return { href, count: bucket.total, label, detail: "No deadline is set" };
  return {
    href,
    count: bucket.total,
    label,
    detail: `Next: ${formatManila(next.dueAt, "d MMM yyyy")}, ${daysLeftPhrase(next.dueAt, now)}`,
    detailTone: dueTone(next),
  };
}

function overdueCell(total: number, rows: QueueRow[], href: string, label: string, now: Date): Cell {
  const oldest = rows.find((row) => row.dueAt);
  return {
    href,
    count: total,
    label,
    detail: total === 0 ? "Nothing is overdue" : oldest?.dueAt ? `Oldest: ${daysLeftPhrase(oldest.dueAt, now)}` : "Past their due date",
    tone: total > 0 ? "danger" : null,
  };
}

type Bucket = { total: number; rows: QueueRow[] };

function WorkCard({
  title,
  href,
  bucket,
  empty,
  action,
  now,
}: {
  title: string;
  href: string;
  bucket: Bucket;
  empty: string;
  action: string;
  now: Date;
}) {
  return (
    <section className="rec-card rec-dash-card">
      <CardHead title={title} href={href} total={bucket.total} shown={bucket.rows.length} />
      {bucket.rows.length === 0 ? (
        <p className="body rec-muted">{empty}</p>
      ) : (
        <ul className="rec-attention">
          {bucket.rows.map((row) => {
            const due = dueLine(row, now);
            return (
              <li key={row.id} className="rec-attention__row">
                <div className="rec-attention__copy">
                  <p className="rec-attention__meta">
                    <span className="code rec-muted">{row.code ?? "Not assigned"}</span>
                    <StatusBadge tone={protocolTone(row.status)} label={row.status} className="rec-badge--dash" />
                    {row.due === "overdue" ? <StatusBadge tone="danger" label="Overdue" className="rec-badge--dash" /> : null}
                  </p>
                  <p className="rec-attention__title">{row.title}</p>
                  <p className="body-sm rec-muted">{stepLine(row)}</p>
                  <p className={due.tone ? `caption rec-tone rec-tone--${due.tone}` : "caption rec-muted"}>{due.text}</p>
                </div>
                <Link className="rec-btn rec-btn--secondary" href={row.href} aria-label={`${action}: ${row.title}`}>
                  {action}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ProtocolCard({ title, href, bucket, empty, now }: { title: string; href: string; bucket: Bucket; empty: string; now?: Date }) {
  return (
    <section className="rec-card rec-dash-card">
      <CardHead title={title} href={href} total={bucket.total} shown={bucket.rows.length} />
      {bucket.rows.length === 0 ? (
        <p className="body rec-muted">{empty}</p>
      ) : (
        <ul className="rec-tally">
          {bucket.rows.map((row) => (
            <li key={row.id} className="rec-tally__row rec-tally__row--stack">
              <Link className="rec-tally__title" href={row.href}>
                {row.title}
              </Link>
              <p className="rec-attention__meta">
                <span className="code rec-muted">{row.code ?? "Not assigned"}</span>
                <StatusBadge tone={protocolTone(row.status)} label={row.status} className="rec-badge--dash" />
              </p>
              {now && row.dueAt ? (
                <p className="caption rec-tone rec-tone--danger">{daysLeftPhrase(row.dueAt, now)}</p>
              ) : (
                <p className="caption rec-muted">{row.step}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StepCard({ title, rows, empty }: { title: string; rows: StepCount[]; empty: string }) {
  return (
    <section className="rec-card rec-dash-card">
      <h2 className="heading">{title}</h2>
      {rows.length === 0 ? (
        <p className="body rec-muted">{empty}</p>
      ) : (
        <ul className="rec-tally">
          {rows.map((row) => (
            <CountItem
              key={`${row.key}-${row.reviewType}`}
              href={row.href}
              count={row.count}
              label={row.name}
              sub={`${REVIEW_WORD[row.reviewType] ?? row.reviewType} review`}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LoadCard({ rows }: { rows: LoadRow[] }) {
  return (
    <section className="rec-card rec-dash-card">
      <CardHead title="Reviewer load" href="/app/reviewers" total={rows.length} shown={rows.length} />
      {rows.length === 0 ? (
        <p className="body rec-muted">No reviewer has an open assessment.</p>
      ) : (
        <ul className="rec-tally">
          {rows.map((row) => (
            <CountItem key={row.userId} href="/app/reviewers" count={row.open} label={row.name} sub={row.open === 1 ? "open assessment" : "open assessments"} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CountItem({ href, count, label, sub }: { href: string; count: number; label: string; sub?: string }) {
  return (
    <li className="rec-tally__row">
      <div className="rec-tally__copy">
        <p className="body-sm">{label}</p>
        {sub ? <p className="caption rec-muted">{sub}</p> : null}
      </div>
      <Link className={count === 0 ? "rec-tally__count rec-muted" : "rec-tally__count"} href={href} aria-label={`${count} ${label}`}>
        {count}
      </Link>
    </li>
  );
}

function CardHead({ title, href, total, shown }: { title: string; href: string; total: number; shown: number }) {
  return (
    <div className="rec-dash-card__head">
      <h2 className="heading">{title}</h2>
      {total > 0 ? (
        <Link className="rec-link" href={href}>
          {total > shown ? `See all ${total}` : "See all"}
        </Link>
      ) : null}
    </div>
  );
}

function TurnaroundTable({ rows }: { rows: TurnaroundSummary[] }) {
  if (rows.length === 0) return <p className="body rec-muted">No panel is in scope for turnaround.</p>;
  return (
    <div className="rec-table-wrap">
      <table className="rec-table rec-table--flat">
        <thead>
          <tr>
            <th scope="col">Review type</th>
            <th scope="col" className="rec-num">
              Limit
            </th>
            <th scope="col" className="rec-num">
              Measured
            </th>
            <th scope="col" className="rec-num">
              Median
            </th>
            <th scope="col" className="rec-num">
              90th percentile
            </th>
            <th scope="col" className="rec-num">
              Within the limit
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.reviewType}>
              <td>{REVIEW_WORD[row.reviewType]}</td>
              <td className="rec-num">{row.limitDays} days</td>
              <td className="rec-num">
                <Link href={`/app/reports?reviewType=${row.reviewType}`}>{row.count}</Link>
              </td>
              <td className="rec-num">{row.medianDays === null ? "—" : `${row.medianDays} days`}</td>
              <td className="rec-num">{row.p90Days === null ? "—" : `${row.p90Days} days`}</td>
              <td className="rec-num">{row.count === 0 ? "—" : `${row.withinLimit} of ${row.count}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stepLine(row: QueueRow): string {
  const holder = row.holder && row.holder !== "—" ? ` · with ${row.holder}` : "";
  return `${row.step}${holder}`;
}

function dueLine(row: QueueRow, now: Date): { text: string; tone: Tone } {
  if (!row.dueAt) return { text: row.note ?? "No deadline", tone: null };
  return { text: `Due ${formatManila(row.dueAt, "EEEE, d MMM yyyy")} · ${daysLeftPhrase(row.dueAt, now)}`, tone: dueTone(row) };
}

function dueTone(row: QueueRow): Tone {
  if (row.due === "overdue") return "danger";
  if (row.due === "soon") return "warning";
  return null;
}

function statClass(count: number, tone: Tone): string {
  if (count === 0) return "rec-stat rec-stat--muted";
  if (tone === "danger") return "rec-stat rec-stat--danger";
  if (tone === "warning") return "rec-stat rec-stat--warning";
  return "rec-stat";
}

function rowName(row: QueueRow): string {
  return row.code ?? row.title;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
