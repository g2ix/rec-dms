import { auditActionLabel, isInternalAuditAction } from "@/lib/audit-log";
import { formatManila } from "@/lib/time";
import { listAuditEvents } from "@/server/audit/query";

function metaText(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

export async function AuditTimeline({
  protocolId,
  simplified = false,
}: {
  protocolId: string;
  simplified?: boolean;
}) {
  const { rows } = await listAuditEvents({
    protocol: protocolId,
    simplified,
    page: 1,
    pageSize: 100,
    order: "asc",
  });
  const visible = simplified ? rows.filter((row) => !isInternalAuditAction(row.action)) : rows;
  if (visible.length === 0) {
    return <p className="body">No activity is recorded for this protocol.</p>;
  }

  return (
    <ol className="rec-methods">
      {visible.map((row) => {
        const ip = metaText(row.meta, "ip");
        const userAgent = metaText(row.meta, "userAgent");
        return (
          <li key={row.id} className="rec-method">
            <div>
              <p className="caption rec-muted">
                <time dateTime={row.occurredAt.toISOString()}>{formatManila(row.occurredAt)}</time>
              </p>
              <p className="body">{auditActionLabel(row.action)}</p>
              <p className="caption rec-muted">{row.actor?.displayName ?? "System"}</p>
            </div>
            {simplified ? null : (
              <p className="caption rec-method__meta">
                {ip ?? "No IP"}
                {userAgent ? ` · ${userAgent}` : ""}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
