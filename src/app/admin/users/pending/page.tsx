import { differenceInCalendarDays } from "date-fns";
import { AlertTriangle, CheckCircle2, MailCheck, MailWarning } from "lucide-react";
import { Icon } from "@/components/icons";
import { PendingDecision } from "@/components/admin/pending-decision";
import type { ProfileKind } from "@/lib/profile";
import { formatManila } from "@/lib/time";
import type { AccountRoleKey } from "@/lib/users/role-authority";
import { profileRows } from "@/server/users/profile-summary";
import { pendingUsers } from "@/server/users/roles";

export const metadata = { title: "Pending approval" };

const DONE: Record<string, string> = {
  approved: "The account was approved. They have been told by email.",
  rejected: "The account was rejected. It can no longer sign in.",
  asked: "A reminder to finish the profile was sent by email and in the app.",
};

/** A sensible starting choice from what the person said they are. Staff can change it. */
function suggestedRoles(kind: ProfileKind | undefined): AccountRoleKey[] {
  if (kind === "EXTERNAL_ADVISER") return ["ADVISER"];
  if (kind === "USC_ACADEMIC" || kind === "USC_STAFF") return ["PROPONENT", "ADVISER"];
  return ["PROPONENT"];
}

function waiting(createdAt: Date): string {
  const days = differenceInCalendarDays(new Date(), createdAt);
  if (days <= 0) return "Signed up today";
  return days === 1 ? "Waiting 1 day" : `Waiting ${days} days`;
}

export default async function PendingUsersPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const users = await pendingUsers();
  const rows = await profileRows(users.map((user) => user.profile));
  const message = done ? DONE[done] : undefined;

  return (
    <section className="rec-stack" aria-label="Pending approval">
      <p className="body rec-muted">
        Accounts without a usc.edu.ph email wait here. Check who they are, choose what the account is for, then approve. A profile must be
        complete first, because every form they file is filled in from it.
      </p>
      {message ? (
        <p className="rec-banner" role="status">
          {message}
        </p>
      ) : null}
      {users.length === 0 ? <p className="rec-empty body">No accounts are waiting. New sign-ups without a USC email will appear here.</p> : null}

      <ul className="rec-pending-list">
        {users.map((user, index) => {
          const complete = user.gaps.length === 0;
          return (
            <li key={user.id} className="rec-card rec-pending">
              <header className="rec-pending__head">
                <div>
                  <h2 className="heading">{user.displayName}</h2>
                  <ul className="rec-pending__emails">
                    {user.emails.map((email) => (
                      <li key={email.email} className="body-sm">
                        <Icon icon={email.verified ? MailCheck : MailWarning} size={16} />
                        {email.email}
                        <span className="rec-muted">{email.verified ? " · verified" : " · not verified"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="caption rec-muted" title={formatManila(user.createdAt, "d MMM yyyy, h:mm a")}>
                  {waiting(user.createdAt)}
                </p>
              </header>

              <div className="rec-pending__body">
                <section aria-label="Profile">
                  <h3 className="label rec-pending__label">
                    Profile
                    {complete ? (
                      <span className="rec-tag rec-tag--ok">
                        <Icon icon={CheckCircle2} size={14} /> Complete
                      </span>
                    ) : (
                      <span className="rec-tag rec-tag--warn">
                        <Icon icon={AlertTriangle} size={14} /> Incomplete
                      </span>
                    )}
                  </h3>
                  {rows[index]!.length > 0 ? (
                    <dl className="rec-facts-grid">
                      {rows[index]!.map((row) => (
                        <div key={row.label}>
                          <dt className="caption rec-muted">{row.label}</dt>
                          <dd className="body">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {complete ? null : (
                    <div className="rec-gaps">
                      <p className="body-sm">Still missing before this account can be approved:</p>
                      <ul>
                        {user.gaps.map((gap) => (
                          <li key={gap} className="body-sm">
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                <PendingDecision
                  userId={user.id}
                  name={user.displayName}
                  complete={complete}
                  suggested={suggestedRoles(user.profile?.kind)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
