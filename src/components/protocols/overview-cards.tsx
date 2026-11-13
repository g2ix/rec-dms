import Link from "next/link";
import { auditActionLabel, isInternalAuditAction } from "@/lib/audit-log";
import { mergeActivity, type ActivityEntry } from "@/lib/protocols/checklist";
import { formatManila } from "@/lib/time";
import { listAuditEvents } from "@/server/audit/query";
import { reviewerNameMask } from "@/server/workflow/read";

export const STAGES = ["Prepare", "Screening", "Review", "Decision"] as const;
export type Stage = (typeof STAGES)[number];

const STAGE_OF: Record<string, Stage> = {
  DRAFT: "Prepare",
  Draft: "Prepare",
  "Returned (incomplete)": "Prepare",
  SUBMITTED: "Screening",
  Submitted: "Screening",
  "Under Screening": "Screening",
  "Under Review": "Review",
  "Awaiting Revision": "Review",
  Resubmitted: "Review",
};

export function stageOf(status: string): Stage {
  return STAGE_OF[status] ?? "Decision";
}

export function StageTrack({ current }: { current: Stage }) {
  return (
    <ol className="rec-stages" aria-label="Stages">
      {STAGES.map((stage) => (
        <li key={stage} className="rec-stages__item" aria-current={stage === current ? "step" : undefined}>
          {stage}
        </li>
      ))}
    </ol>
  );
}

type TeamMember = {
  id: string;
  userId: string | null;
  role: string;
  isLeader: boolean;
  status: string;
  invitedEmail: string | null;
  user: { displayName: string } | null;
};

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

function roleText(member: TeamMember): string {
  if (member.isLeader) return "Project leader";
  if (member.role === "ADVISER") return "Adviser";
  return "Co-proponent";
}

export function TeamCard({
  protocolId,
  members,
  viewerId,
  manage = true,
  note,
}: {
  protocolId: string;
  members: TeamMember[];
  viewerId: string;
  /** Show the "Manage members" link. The Intake page shows it to the leader only. */
  manage?: boolean;
  note?: React.ReactNode;
}) {
  const team = members.filter((member) => member.role === "PROPONENT" || member.role === "ADVISER");
  return (
    <section className="rec-card rec-stack" aria-labelledby="team-heading">
      <div className="rec-card__head">
        <h2 id="team-heading" className="heading">
          Team
        </h2>
        {manage ? (
          <Link className="label rec-touch" href={`/app/protocols/${protocolId}/members`}>
            Manage members
          </Link>
        ) : null}
      </div>
      {note}
      <ul className="rec-team">
        {team.map((member) => {
          const name = member.user?.displayName ?? member.invitedEmail ?? "Invited member";
          const facts = [roleText(member), member.status === "INVITED" ? "Invited" : null, member.userId === viewerId ? "You" : null].filter(Boolean);
          return (
            <li key={member.id} className="rec-team__chip">
              <span className="rec-avatar" aria-hidden="true">
                {initials(name)}
              </span>
              <span>
                <span className="body-sm rec-team__name">{name}</span>
                <span className="caption rec-muted">{facts.join(" · ")}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function when(entry: ActivityEntry, today: string): string {
  const sameDay = formatManila(entry.first, "yyyy-MM-dd") === formatManila(entry.last, "yyyy-MM-dd");
  const day = formatManila(entry.last, "yyyy-MM-dd") === today ? null : formatManila(entry.last, "d MMM yyyy");
  const end = formatManila(entry.last, "h:mm a");
  if (entry.count === 1 || entry.first.getTime() === entry.last.getTime()) return day ? `${day}, ${end}` : end;
  if (!sameDay) return `${formatManila(entry.first, "d MMM yyyy, h:mm a")} – ${formatManila(entry.last, "d MMM yyyy, h:mm a")}`;
  const range = `${formatManila(entry.first, "h:mm")}–${end}`;
  return day ? `${day}, ${range}` : range;
}

/** The newest five activity entries, with repeats by the same person merged. The Activity tab has the rest. */
export async function RecentActivity({ protocolId, viewerId, limit = 5 }: { protocolId: string; viewerId: string; limit?: number }) {
  const [{ rows }, nameFor] = await Promise.all([
    listAuditEvents({ protocol: protocolId, simplified: true, page: 1, pageSize: 60, order: "desc" }),
    reviewerNameMask(protocolId, viewerId),
  ]);
  const entries = mergeActivity(
    rows
      .filter((row) => !isInternalAuditAction(row.action))
      .map((row) => ({
        id: row.id,
        label: auditActionLabel(row.action),
        who: nameFor(row.actorUserId, row.actor?.displayName) ?? "System",
        at: row.occurredAt,
      })),
  ).slice(0, limit);
  const today = formatManila(new Date(), "yyyy-MM-dd");
  return (
    <section className="rec-card rec-stack" aria-labelledby="activity-heading">
      <div className="rec-card__head">
        <h2 id="activity-heading" className="heading">
          Recent activity
        </h2>
        <Link className="label" href={`/app/protocols/${protocolId}/activity`}>
          See all activity
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="body-sm rec-muted">No activity is recorded for this protocol.</p>
      ) : (
        <ol className="rec-timeline">
          {entries.map((entry) => (
            <li key={entry.id} className="rec-timeline__item">
              <p className="body-sm">
                {entry.label}
                {entry.count > 1 ? <span className="rec-muted"> · {entry.count} times</span> : null}
              </p>
              <p className="caption rec-muted">
                {entry.who} · <time dateTime={entry.last.toISOString()}>{when(entry, today)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
