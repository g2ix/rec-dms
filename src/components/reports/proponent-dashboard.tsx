import Link from "next/link";
import { SUBMISSION_GUIDE_HREF, SUBMISSION_READY, SUBMISSION_STEPS } from "@/content/submission-checklist";
import {
  attentionItems,
  daysLeftPhrase,
  deadlineTone,
  profileProgress,
  revisionLabel,
  statusDetail,
  workingDaysFromNote,
  type ActivityPart,
  type DeadlineTone,
} from "@/lib/dashboard/proponent";
import type { PersonProfileView } from "@/lib/profile";
import { formatManila } from "@/lib/time";
import { protocolTone } from "@/components/reports/queue-table";
import type { ActivityEvent } from "@/server/reports/activity";
import type { DashboardModel } from "@/server/reports/dashboard";
import { StatusBadge } from "@/components/ui/status-badge";

type ProponentModel = Extract<DashboardModel, { view: "proponent" }>;

export function ProponentDashboard({
  model,
  profile,
  activity,
  viewerName,
  now = new Date(),
}: {
  model: ProponentModel;
  profile: PersonProfileView | null;
  activity: ActivityEvent[];
  viewerName: string;
  now?: Date;
}) {
  const hasProtocols = model.protocols.total > 0;
  const progress = profileProgress(profile);
  const nearest = model.revisions.rows.find((row) => row.dueAt);
  const revisionDays = workingDaysFromNote(nearest?.note ?? null);
  const revisionTone = model.revisions.total > 0 ? deadlineTone(revisionDays) : null;
  const attention = attentionItems(model.waiting.rows, model.revisions.rows);
  const recent = [...model.protocols.rows]
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
    .slice(0, 5);

  return (
    <article className="rec-dash">
      <header className="rec-dash-head">
        <div>
          <p className="rec-dash-date">{formatManila(now, "EEEE, d MMMM yyyy")}</p>
          <h1 className="title">Dashboard</h1>
        </div>
        {hasProtocols ? (
          <Link className="rec-btn rec-btn--primary" href="/app/protocols/new">
            New protocol
          </Link>
        ) : null}
      </header>

      <section className="rec-strip" aria-label="Summary">
        <Link className="rec-strip__cell" href="/app/tasks">
          <p className={model.waiting.total === 0 ? "rec-stat rec-stat--muted" : "rec-stat"}>{model.waiting.total}</p>
          <p className="rec-strip__label">Waiting for you</p>
          <p className="rec-strip__detail">
            {model.waiting.total === 0
              ? "Signatures and replies the REC needs from you"
              : model.waiting.rows[0]?.step || "Open My tasks"}
          </p>
        </Link>
        <Link className="rec-strip__cell" href="/app/protocols?status=returned">
          <p className={countClass(model.revisions.total, revisionTone)}>{model.revisions.total}</p>
          <p className="rec-strip__label">{revisionLabel(model.revisions.total)}</p>
          <p className={detailClass(model.revisions.total === 0 ? null : revisionTone)}>
            {revisionDetail(model.revisions.total, nearest?.dueAt ?? null, now)}
          </p>
        </Link>
        <Link className="rec-strip__cell" href="/app/protocols">
          <p className={model.protocols.total === 0 ? "rec-stat rec-stat--muted" : "rec-stat"}>{model.protocols.total}</p>
          <p className="rec-strip__label">Protocols</p>
          <p className="rec-strip__detail">
            {model.protocols.total === 0 ? "Drafts, under review and decided" : statusDetail(model.statuses)}
          </p>
        </Link>
      </section>

      <div className="rec-dash__grid">
        <div className="rec-dash__main">
          {hasProtocols ? (
            <>
              {attention.length > 0 ? (
                <section className="rec-card rec-dash-card">
                  <h2 className="heading">Needs your attention</h2>
                  <ul className="rec-attention">
                    {attention.map((item) => {
                      const due = dueCopy(item, viewerName, now);
                      return (
                        <li key={item.id} className="rec-attention__row">
                          <div className="rec-attention__copy">
                            <p className="rec-attention__meta">
                              <span className="code rec-muted">{item.code ?? "Not assigned"}</span>
                              <StatusBadge tone={protocolTone(item.status)} label={item.status} className="rec-badge--dash" />
                            </p>
                            <p className="rec-attention__title">{item.title}</p>
                            <p className={due.tone ? `caption rec-tone rec-tone--${due.tone}` : "caption rec-muted"}>{due.text}</p>
                          </div>
                          <Link className="rec-btn rec-btn--secondary" href={item.href}>
                            {item.action}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
              <section className="rec-card rec-dash-card">
                <div className="rec-dash-card__head">
                  <h2 className="heading">Your protocols</h2>
                  <Link className="rec-link" href="/app/protocols">
                    See all
                  </Link>
                </div>
                {recent.length === 0 ? (
                  <p className="body">You have no protocols yet.</p>
                ) : (
                  <div className="rec-table-wrap">
                    <table className="rec-table rec-table--flat">
                      <thead>
                        <tr>
                          <th scope="col">Code</th>
                          <th scope="col">Title</th>
                          <th scope="col">Status</th>
                          <th scope="col" className="rec-num">
                            Last update
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <Link className="code" href={row.href}>
                                {row.code ?? "Not assigned"}
                              </Link>
                            </td>
                            <td>{row.title}</td>
                            <td>
                              <StatusBadge tone={protocolTone(row.status)} label={row.status} className="rec-badge--dash" />
                            </td>
                            <td className="rec-num">{row.updatedAt ? formatManila(row.updatedAt, "d MMM yyyy") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="rec-card rec-start">
              <h2 className="heading">Start your first protocol</h2>
              <p className="body rec-muted">
                You can save a draft at any point and come back to it. Here is how a protocol moves through the REC.
              </p>
              <ol className="rec-steps">
                {SUBMISSION_STEPS.map((step, index) => (
                  <li key={step.name} className="rec-step">
                    <div className="rec-step__rail">
                      <span className={index === 0 ? "rec-step__num rec-step__num--on" : "rec-step__num"}>{index + 1}</span>
                      {index < SUBMISSION_STEPS.length - 1 ? <span className="rec-step__line" aria-hidden="true" /> : null}
                    </div>
                    <p className="rec-step__name">{step.name}</p>
                    <p className="rec-step__detail">{step.detail}</p>
                  </li>
                ))}
              </ol>
              <hr className="rec-dash-rule" />
              <div className="rec-start__foot">
                <div>
                  <h3 className="subheading">Have these ready</h3>
                  <ul className="rec-ready">
                    {SUBMISSION_READY.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rec-start__actions">
                  <Link className="rec-link" href={SUBMISSION_GUIDE_HREF}>
                    Read the submission guide
                  </Link>
                  <Link className="rec-btn rec-btn--primary" href="/app/protocols/new">
                    Start a new protocol
                  </Link>
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="rec-dash__side">
          {!hasProtocols && progress.missing ? (
            <section className="rec-card rec-dash-card">
              <div className="rec-dash-card__head">
                <h2 className="heading">Your details</h2>
                <p className="caption rec-muted">
                  {progress.done} of {progress.total} done
                </p>
              </div>
              <div className="rec-progress rec-progress--sunken" aria-hidden="true">
                <div className="rec-progress__track">
                  <div className="rec-progress__bar" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                </div>
              </div>
              <p className="body-sm">
                {progress.missing.label} is missing. {progress.missing.why}
              </p>
              <Link className="rec-link" href="/app/account/profile">
                Finish your details
              </Link>
            </section>
          ) : null}

          {hasProtocols ? (
            <ActivityCard events={activity} />
          ) : (
            <section className="rec-card rec-dash-card">
              <h2 className="heading">Needs your attention</h2>
              <p className="body rec-muted">
                Nothing right now. Returned protocols, signature requests and REC notices will show up here.
              </p>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}

function ActivityCard({ events }: { events: ActivityEvent[] }) {
  return (
    <section className="rec-card rec-dash-card">
      <h2 className="heading">Recent activity</h2>
      {events.length === 0 ? (
        <p className="body rec-muted">Nothing has been recorded on your protocols yet.</p>
      ) : (
        <ol className="rec-timeline">
          {events.map((event, index) => (
            <li key={event.id} className="rec-timeline__item">
              <div className="rec-timeline__mark" aria-hidden="true">
                <span className={`rec-timeline__dot rec-timeline__dot--${event.tone}`} />
                {index < events.length - 1 ? <span className="rec-timeline__line" /> : null}
              </div>
              <div>
                <p className="body-sm">
                  {event.parts.map((part, partIndex) => (
                    <ActivityText key={`${event.id}-${partIndex}`} part={part} />
                  ))}
                </p>
                <p className="caption rec-muted">{formatManila(event.at, "d MMM yyyy, h:mm a")}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityText({ part }: { part: ActivityPart }) {
  if (part.kind === "code") return <span className="code">{part.text}</span>;
  return part.text;
}

function revisionDetail(count: number, dueAt: Date | null, now: Date): string {
  if (count === 0) return "Returned protocols with a due date";
  if (!dueAt) return "No deadline is set";
  return `Nearest: ${formatManila(dueAt, "d MMM yyyy")}, ${daysLeftPhrase(dueAt, now)}`;
}

function countClass(count: number, tone: DeadlineTone): string {
  if (count === 0) return "rec-stat rec-stat--muted";
  if (tone === "warning") return "rec-stat rec-stat--warning";
  if (tone === "danger") return "rec-stat rec-stat--danger";
  return "rec-stat";
}

function detailClass(tone: DeadlineTone): string {
  if (tone === "warning" || tone === "danger") return `rec-strip__detail rec-tone rec-tone--${tone}`;
  return "rec-strip__detail";
}

function dueCopy(
  item: { kind: "revision" | "signature"; dueAt: Date | null; openedAt: Date | null; askedBy: string | null; workingDays: number | null },
  viewerName: string,
  now: Date,
): { text: string; tone: DeadlineTone } {
  if (item.kind === "revision" && item.dueAt) {
    return {
      text: `Revise by ${formatManila(item.dueAt, "EEEE, d MMM yyyy")} · ${daysLeftPhrase(item.dueAt, now)}`,
      tone: deadlineTone(item.workingDays),
    };
  }
  const when = item.openedAt ? formatManila(item.openedAt, "d MMM yyyy") : null;
  const asked = item.askedBy && item.askedBy !== viewerName ? item.askedBy : null;
  if (asked && when) return { text: `Requested by ${asked} on ${when}`, tone: null };
  if (when) return { text: `Requested on ${when}`, tone: null };
  return { text: "No deadline", tone: null };
}
