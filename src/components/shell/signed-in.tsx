import { cookies } from "next/headers";
import { Clock } from "lucide-react";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell/app-shell";
import { EMPTY_NAV_CAPABILITIES, type NavCapabilities } from "@/components/shell/nav";
import { redirect } from "next/navigation";
import { resolveRoleView } from "@/server/auth/view";
import {
  canEditForms,
  canEditHolidays,
  canManageFees,
  canEditSettings,
  canEditWorkflow,
  canManageUsers,
  canReviewRetention,
  canViewAudit,
} from "@/server/authz/policy";
import { userAdminFacts } from "@/server/authz/user-admin";
import { AppError } from "@/server/errors";
import { inboxTotal } from "@/server/workflow/inbox";
import { requireUser } from "@/server/session";

function navCapabilitiesFromFacts(facts: Awaited<ReturnType<typeof userAdminFacts>>): NavCapabilities {
  return {
    manageUsers: canManageUsers(facts),
    viewAudit: canViewAudit(facts),
    editForms: canEditForms(facts),
    editWorkflow: canEditWorkflow(facts),
    editSettings: canEditSettings(facts),
    editHolidays: canEditHolidays(facts),
    reviewRetention: canReviewRetention(facts),
    manageFees: canManageFees(facts),
  };
}

export async function SignedInChrome({
  children,
  pageTitle,
}: {
  children: React.ReactNode;
  pageTitle?: string;
}) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    // A page cannot change cookies while it renders; the route handler ends the session.
    if (error instanceof AppError && (error.code === "SUSPENDED" || error.code === "UNAUTHENTICATED")) {
      redirect("/api/session/end");
    }
    throw error;
  }
  const jar = await cookies();
  const { view: roleView, views: roleViews } = await resolveRoleView(user.id, jar.get("activeView")?.value);
  const showAdminNav = roleView === "staff" || roleView === "chair";
  const [waiting, adminFacts] = await Promise.all([
    inboxTotal(user.id, roleView),
    showAdminNav ? userAdminFacts(user.id) : null,
  ]);
  return (
    <AppShell
      collapsed={jar.get("sidebar")?.value === "rail"}
      pageTitle={pageTitle}
      roleView={roleView}
      roleViews={roleViews}
      navCapabilities={adminFacts ? navCapabilitiesFromFacts(adminFacts) : EMPTY_NAV_CAPABILITIES}
      account={{ name: user.displayName, email: user.email ?? "" }}
      counts={waiting > 0 ? { "/app/tasks": { value: waiting, waiting: true } } : undefined}
    >
      {user.status === "PENDING_APPROVAL" ? (
        <p className="rec-banner rec-banner--pending" role="status">
          <Icon icon={Clock} size={18} />
          <span>
            <strong>Your account is waiting for REC Staff approval.</strong> You can prepare everything now. You can submit once your account is
            approved.
          </span>
        </p>
      ) : null}
      {children}
    </AppShell>
  );
}
