import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Icon } from "@/components/icons";
import { RoleBoard } from "@/components/admin/role-board";
import { UserStatusBadge } from "@/components/admin/user-status-badge";
import { formatManila } from "@/lib/time";
import { requireUser } from "@/server/session";
import { profileRows } from "@/server/users/profile-summary";
import { userRoleDetail } from "@/server/users/roles";

export const metadata = { title: "Person" };

function doneMessage(done: string | undefined): string | null {
  const match = done?.match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  const granted = Number(match[1]);
  const revoked = Number(match[2]);
  const parts = [granted ? `${granted} granted` : "", revoked ? `${revoked} revoked` : ""].filter(Boolean);
  return parts.length ? `Saved: ${parts.join(", ")}.` : null;
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const actor = await requireUser();
  const { id } = await params;
  const { done } = await searchParams;
  const detail = await userRoleDetail(actor.id, id);
  if (!detail) notFound();
  const [rows] = await profileRows([detail.profile]);
  const message = doneMessage(done);

  return (
    <article className="rec-stack">
      <p className="body-sm">
        <Link href="/admin/users" className="rec-back">
          <Icon icon={ArrowLeft} size={16} /> All people
        </Link>
      </p>

      <section className="rec-card rec-person-head" aria-label="About this person">
        <div className="rec-person-head__id">
          <h2 className="title">{detail.displayName}</h2>
          <div className="rec-actions">
            <span className="body">{detail.email ?? "No email"}</span>
            <UserStatusBadge status={detail.status} />
          </div>
          <p className="caption rec-muted">
            Signed up {formatManila(detail.createdAt, "d MMM yyyy")}
            {detail.approvedAt ? ` · approved ${formatManila(detail.approvedAt, "d MMM yyyy")}` : ""}
          </p>
        </div>
        {rows && rows.length > 0 ? (
          <dl className="rec-facts-grid">
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="caption rec-muted">{row.label}</dt>
                <dd className="body">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {detail.profileGaps.length > 0 ? (
          <div className="rec-gaps">
            <p className="body-sm">Profile not complete:</p>
            <ul>
              {detail.profileGaps.map((gap) => (
                <li key={gap} className="body-sm">
                  {gap}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {detail.status === "PENDING_APPROVAL" ? (
          <p className="body-sm">
            This account is waiting. <Link href="/admin/users/pending">Review it under Pending approval</Link>.
          </p>
        ) : null}
      </section>

      {message ? (
        <p className="rec-banner" role="status">
          {message}
        </p>
      ) : null}

      {/* Remounts after a save so staged changes clear once the grants they named exist. */}
      <RoleBoard
        key={detail.cards.map((card) => [card.grantId, ...(card.panels ?? []).map((panel) => panel.grantId)].join(",")).join(";")}
        userId={detail.id} active={detail.status === "ACTIVE"} cards={detail.cards} />

      {detail.otherGrants.length > 0 ? (
        <p className="body-sm rec-muted">Also holds: {detail.otherGrants.map((grant) => grant.roleName).join(", ")}.</p>
      ) : null}
    </article>
  );
}
