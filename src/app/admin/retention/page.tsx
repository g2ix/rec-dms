import { redirect } from "next/navigation";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";
import { formatManila } from "@/lib/time";
import { retentionPolicy } from "@/server/privacy/retention";

export const metadata = { title: "Retention" };

export default async function RetentionPage() {
  const user = await requireUser();
  try {
    await authorize(user, "retention.review");
  } catch {
    redirect("/app");
  }
  const policy = await retentionPolicy();
  const rows = await prisma.protocol.findMany({
    where: { retentionFlaggedAt: { not: null } },
    orderBy: { retentionFlaggedAt: "asc" },
    take: 100,
    select: { id: true, code: true, title: true, status: true, retentionFlaggedAt: true },
  });
  return (
    <article className="rec-stack">
      <h1 className="title">Retention</h1>
      <p className="body rec-muted">
        Closed protocols older than {policy.years} years are listed here for REC Staff to archive or delete. The weekly job only flags them. It does not delete anything.
      </p>
      {rows.length === 0 ? <p className="body">No protocols are waiting for a retention decision.</p> : null}
      <ul className="rec-methods">
        {rows.map((row) => (
          <li key={row.id} className="rec-card rec-stack">
            <p className="label">{row.code ?? "No protocol code yet"}</p>
            <p className="body">{row.title}</p>
            <p className="caption rec-muted">
              {row.status}
              {row.retentionFlaggedAt ? ` · flagged ${formatManila(row.retentionFlaggedAt, "d MMMM yyyy")}` : ""}
            </p>
            <a className="rec-btn rec-btn--secondary" href={`/app/protocols/${row.id}`}>
              <span>Open protocol</span>
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
