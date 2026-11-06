import Link from "next/link";
import { CountHeading, QueueTable } from "@/components/reports/queue-table";
import type { DashboardModel, LoadRow, StepCount } from "@/server/reports/dashboard";
import type { TurnaroundSummary } from "@/lib/reports/metrics";

const REVIEW_WORD: Record<string, string> = {
  EXEMPT: "Exempt",
  EXPEDITED: "Expedited",
  FULL: "Full",
};

export function DashboardView({ model }: { model: DashboardModel }) {
  if (model.view === "proponent") {
    return (
      <>
        <section className="rec-stack">
          <CountHeading count={model.waiting.total} href="/app/tasks" label="waiting for you" />
          <QueueTable rows={model.waiting.rows} empty="Nothing is waiting on you." />
        </section>
        <section className="rec-stack" id="revisions">
          <CountHeading count={model.revisions.total} href="/app/revisions" label="revision deadlines" />
          <QueueTable rows={model.revisions.rows} empty="No revision is waiting on you." />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.protocols.total} href="/app/protocols" label="protocols" />
          <QueueTable rows={model.protocols.rows} empty="You have no protocols yet." />
        </section>
      </>
    );
  }
  if (model.view === "adviser") {
    return (
      <>
        <section className="rec-stack">
          <CountHeading count={model.waiting.total} href="/app/tasks" label="signatures and reviews waiting" />
          <QueueTable rows={model.waiting.rows} empty="No signature or F-38 review is waiting." />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.protocols.total} href="/app/advised" label="protocols you advise" />
          <QueueTable rows={model.protocols.rows} empty="You are not advising a protocol yet." />
        </section>
      </>
    );
  }
  if (model.view === "reviewer") {
    return (
      <>
        <section className="rec-stack">
          <CountHeading count={model.open.total} href="/app/reviews" label="assigned reviews" />
          <QueueTable rows={model.open.rows} empty="No review is assigned to you." />
        </section>
        <section className="rec-stack" id="completed">
          <CountHeading count={model.completed.total} href="/app/reviews#completed" label="completed reviews" />
          <QueueTable rows={model.completed.rows} empty="You have not completed a review yet." />
        </section>
      </>
    );
  }
  if (model.view === "panel-chair") {
    return (
      <>
        <p className="body rec-muted">{model.panelLabel}</p>
        <section className="rec-stack">
          <CountHeading count={model.waiting.total} href="/app/decisions" label="decisions waiting" />
          <QueueTable rows={model.waiting.rows} empty="No decision is waiting." />
        </section>
        <section className="rec-stack">
          <h2 className="heading">Protocols by step</h2>
          <StepTable rows={model.steps} empty="No protocol is open in your panel." />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.loads.length} href="/app/reviewers" label="reviewers with open work" />
          <LoadTable rows={model.loads} />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.overdue.total} href="/app/overdue" label="overdue in your panel" />
          <QueueTable rows={model.overdue.rows} empty="Nothing in your panel is overdue." />
        </section>
      </>
    );
  }
  if (model.view === "staff") {
    return (
      <>
        <section className="rec-stack">
          <CountHeading count={model.waiting.total} href="/app/tasks" label="tasks in your inbox" />
          <QueueTable rows={model.waiting.rows} empty="Your inbox is clear." />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.screening.total} href="/app/screening" label="in the screening queue" />
          <QueueTable rows={model.screening.rows} empty="The screening queue is empty." />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.receipts} href="/app/receipts" label="fee receipts to verify" />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.releases.total} href="/app/releases" label="decisions to release" />
          <QueueTable rows={model.releases.rows} empty="No decision is waiting to be released." />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.pendingUsers} href="/app/users" label="accounts waiting for approval" />
        </section>
        <section className="rec-stack">
          <CountHeading count={model.overdue.total} href="/app/overdue" label="overdue tasks" />
          <QueueTable rows={model.overdue.rows} empty="Nothing is overdue." />
        </section>
      </>
    );
  }
  return (
    <>
      <section className="rec-stack">
        <CountHeading count={model.waiting.total} href="/app/tasks" label="tasks in your inbox" />
        <QueueTable rows={model.waiting.rows} empty="Your inbox is clear." />
      </section>
      <section className="rec-stack">
        <h2 className="heading">Pipeline</h2>
        <StepTable rows={model.pipeline} empty="No protocol is in review." />
      </section>
      <section className="rec-stack">
        <CountHeading count={model.overdue} href="/app/overdue" label="overdue tasks" />
      </section>
      <section className="rec-stack">
        <h2 className="heading">Turnaround from complete documents</h2>
        <TurnaroundTable rows={model.turnaround} />
      </section>
    </>
  );
}

function StepTable({ rows, empty }: { rows: StepCount[]; empty: string }) {
  if (rows.length === 0) return <p className="body">{empty}</p>;
  return (
    <div className="rec-table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Review type</th>
            <th scope="col">Protocols</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.key}-${row.reviewType}`}>
              <td>{row.name}</td>
              <td>{REVIEW_WORD[row.reviewType] ?? row.reviewType}</td>
              <td>
                <Link href={row.href}>{row.count}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadTable({ rows }: { rows: LoadRow[] }) {
  if (rows.length === 0) return <p className="body">No reviewer has an open assessment.</p>;
  return (
    <div className="rec-table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th scope="col">Reviewer</th>
            <th scope="col">Open assessments</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId}>
              <td>{row.name}</td>
              <td>
                <Link href="/app/reviewers">{row.open}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TurnaroundTable({ rows }: { rows: TurnaroundSummary[] }) {
  return (
    <div className="rec-table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th scope="col">Review type</th>
            <th scope="col">Limit</th>
            <th scope="col">Measured</th>
            <th scope="col">Median</th>
            <th scope="col">90th percentile</th>
            <th scope="col">Within the limit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.reviewType}>
              <td>{REVIEW_WORD[row.reviewType]}</td>
              <td>{row.limitDays} days</td>
              <td>
                <Link href={`/app/reports?reviewType=${row.reviewType}`}>{row.count}</Link>
              </td>
              <td>{row.medianDays === null ? "—" : `${row.medianDays} days`}</td>
              <td>{row.p90Days === null ? "—" : `${row.p90Days} days`}</td>
              <td>{row.count === 0 ? "—" : `${row.withinLimit} of ${row.count}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
