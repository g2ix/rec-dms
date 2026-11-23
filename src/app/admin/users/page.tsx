import Link from "next/link";
import type { UserStatus } from "@prisma/client";
import { ChevronRight, Search } from "lucide-react";
import { Icon } from "@/components/icons";
import { UserStatusBadge } from "@/components/admin/user-status-badge";
import { isAccountRole } from "@/lib/users/role-authority";
import { listUsersWithRoles, userStatusCounts } from "@/server/users/roles";

export const metadata = { title: "User management" };

const FILTERS: { value: "" | "active" | "pending" | "suspended"; label: string; status?: UserStatus }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active", status: "ACTIVE" },
  { value: "pending", label: "Pending", status: "PENDING_APPROVAL" },
  { value: "suspended", label: "Suspended", status: "SUSPENDED" },
];

function filterHref(q: string, status: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const query = params.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const filter = FILTERS.find((item) => item.value === query.status) ?? FILTERS[0]!;
  const [users, counts] = await Promise.all([listUsersWithRoles(q, filter.status), userStatusCounts()]);
  const countOf: Record<string, number> = {
    "": counts.active + counts.pending + counts.suspended,
    active: counts.active,
    pending: counts.pending,
    suspended: counts.suspended,
  };

  return (
    <section className="rec-stack" aria-label="People">
      <p className="body rec-muted">Open a person to see their profile and change what they can do.</p>
      <div className="rec-user-toolbar">
        <form className="rec-user-search" action="/admin/users" role="search">
          {filter.value ? <input type="hidden" name="status" value={filter.value} /> : null}
          <label className="rec-visually-hidden" htmlFor="user-search">
            Search people
          </label>
          <Icon icon={Search} size={18} />
          <input id="user-search" name="q" className="rec-input" defaultValue={q} placeholder="Search by name or email" />
          <button className="rec-btn rec-btn--secondary" type="submit">
            <span>Search</span>
          </button>
        </form>
        <div className="rec-segment" role="group" aria-label="Show">
          {FILTERS.map((item) => (
            <Link key={item.value} href={filterHref(q, item.value)} aria-current={item.value === filter.value ? "true" : undefined}>
              {item.label}
              <span className="rec-segment__count">{countOf[item.value]}</span>
            </Link>
          ))}
        </div>
      </div>

      {users.length === 0 ? (
        <p className="rec-empty body">{q ? `No one matches “${q}”.` : "No accounts here."}</p>
      ) : (
        <ul className="rec-people" aria-label="People">
          {users.map((user) => (
            <li key={user.id}>
              <Link href={`/admin/users/${user.id}`} className="rec-person-row">
                <span className="rec-person-row__who">
                  <span className="rec-person-row__name">{user.displayName}</span>
                  <span className="body-sm rec-muted">{user.email ?? "No email"}</span>
                </span>
                <span className="rec-person-row__status">
                  <UserStatusBadge status={user.status} />
                </span>
                <span className="rec-person-row__roles">
                  {user.roles.length === 0 ? (
                    <span className="body-sm rec-muted">No roles yet</span>
                  ) : (
                    user.roles.map((role) => (
                      <span key={role.key} className={`rec-role-chip${isAccountRole(role.key) ? " rec-role-chip--account" : ""}`}>
                        {role.name}
                      </span>
                    ))
                  )}
                </span>
                <span className="rec-person-row__go">
                  Manage
                  <Icon icon={ChevronRight} size={18} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {users.length === 50 ? <p className="body-sm rec-muted">Showing the first 50. Search to narrow the list.</p> : null}
    </section>
  );
}
