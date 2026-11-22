import {
  Ban,
  FilePlus,
  FileText,
  GitBranch,
  Paperclip,
  PenLine,
  Receipt,
  Send,
  ShieldX,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Icon } from "@/components/icons";
import { auditActionLabel, isInternalAuditAction } from "@/lib/audit-log";
import { formatManila } from "@/lib/time";
import { listAuditEvents } from "@/server/audit/query";
import { reviewerNameMask } from "@/server/workflow/read";

function metaText(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

type Tone = "primary" | "info" | "success" | "warning" | "danger" | "muted";

/** The marker on the line: an icon and a color that say what kind of event this was. */
function markerFor(action: string): { icon: LucideIcon; tone: Tone } {
  if (action === "file.infected") return { icon: ShieldX, tone: "danger" };
  if (action === "workflow.instance_cancelled" || action === "protocol.fee_rejected" || action.endsWith("_voided") || action.endsWith("_withdrawn")) {
    return { icon: Ban, tone: "danger" };
  }
  if (action === "protocol.created") return { icon: FilePlus, tone: "primary" };
  if (action === "protocol.version_submitted" || action === "protocol.revision_started") return { icon: Send, tone: "success" };
  if (action.startsWith("protocol.fee_")) return { icon: Receipt, tone: "success" };
  if (action.startsWith("protocol.file_")) return { icon: Paperclip, tone: "info" };
  if (action.startsWith("workflow.")) return { icon: GitBranch, tone: "info" };
  if (action.endsWith(".signed") || action.endsWith("_signed") || action === "intake.agreed" || action === "signature.saved") {
    return { icon: PenLine, tone: "success" };
  }
  if (action.startsWith("protocol.member_") || action === "protocol.invite_bound" || action === "protocol.roster_reordered" || action === "protocol.panel_changed") {
    return { icon: Users, tone: "warning" };
  }
  if (action === "protocol.leadership_transferred" || action.startsWith("user.") || action.startsWith("role.")) return { icon: UserCog, tone: "warning" };
  if (action.startsWith("form.") || action.startsWith("intake.") || action.startsWith("revision.")) return { icon: FileText, tone: "muted" };
  return { icon: FileText, tone: "muted" };
}

export async function AuditTimeline({
  protocolId,
  viewerUserId,
  simplified = false,
  order = "asc",
}: {
  protocolId: string;
  /** Null is the complete record on the admin audit page. Protocol pages pass the signed-in user. */
  viewerUserId: string | null;
  simplified?: boolean;
  /** "desc" puts the latest event first (the protocol's Activity tab). */
  order?: "asc" | "desc";
}) {
  const [{ rows }, nameFor] = await Promise.all([
    listAuditEvents({
      protocol: protocolId,
      simplified,
      page: 1,
      pageSize: 100,
      order,
    }),
    viewerUserId ? reviewerNameMask(protocolId, viewerUserId) : null,
  ]);
  const visible = simplified ? rows.filter((row) => !isInternalAuditAction(row.action)) : rows;
  if (visible.length === 0) {
    return <p className="body">No activity is recorded for this protocol.</p>;
  }

  // One group per Manila day, in the order the rows came.
  const days: { key: string; label: string; rows: typeof visible }[] = [];
  for (const row of visible) {
    const key = formatManila(row.occurredAt, "yyyy-MM-dd");
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else days.push({ key, label: formatManila(row.occurredAt, "EEEE, d MMMM yyyy"), rows: [row] });
  }

  return (
    <div className="rec-activity">
      {days.map((day) => (
        <section key={day.key} className="rec-activity__day" aria-label={day.label}>
          <h3 className="rec-activity__date label">{day.label}</h3>
          <ol className="rec-activity__list">
            {day.rows.map((row) => {
              const ip = metaText(row.meta, "ip");
              const userAgent = metaText(row.meta, "userAgent");
              const marker = markerFor(row.action);
              const who = (nameFor ? nameFor(row.actorUserId, row.actor?.displayName) : row.actor?.displayName) ?? "System";
              return (
                <li key={row.id} className="rec-activity__item">
                  <span className="rec-activity__rail" aria-hidden="true">
                    <span className={`rec-activity__marker rec-activity__marker--${marker.tone}`}>
                      <Icon icon={marker.icon} size={14} />
                    </span>
                    <span className="rec-activity__line" />
                  </span>
                  <div className="rec-activity__card">
                    <div className="rec-activity__head">
                      <p className="body rec-activity__what">{auditActionLabel(row.action)}</p>
                      <time className="caption rec-muted rec-activity__time" dateTime={row.occurredAt.toISOString()}>
                        {formatManila(row.occurredAt, "h:mm a")}
                      </time>
                    </div>
                    <p className="caption rec-muted">by {who}</p>
                    {simplified ? null : (
                      <p className="caption rec-activity__meta">
                        {ip ?? "No IP"}
                        {userAgent ? ` · ${userAgent}` : ""}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
