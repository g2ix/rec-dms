import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { signOut } from "@/server/auth";
import { resolveRoleView } from "@/server/auth/view";
import { AppError } from "@/server/errors";
import { inboxTotal } from "@/server/workflow/inbox";
import { requireUser } from "@/server/session";

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
    if (error instanceof AppError && error.code === "SUSPENDED") {
      await signOut({ redirectTo: "/sign-in?error=Suspended" });
    }
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      await signOut({ redirectTo: "/sign-in" });
    }
    throw error;
  }
  const jar = await cookies();
  const { view: roleView, views: roleViews } = await resolveRoleView(user.id, jar.get("activeView")?.value);
  const waiting = await inboxTotal(user.id, roleView);
  return (
    <AppShell
      collapsed={jar.get("sidebar")?.value === "rail"}
      pageTitle={pageTitle}
      roleView={roleView}
      roleViews={roleViews}
      account={{ name: user.displayName, email: user.email ?? "" }}
      counts={waiting > 0 ? { "/app/tasks": { value: waiting, waiting: true } } : undefined}
    >
      {user.status === "PENDING_APPROVAL" ? (
        <p className="rec-banner" role="status">
          Your account is waiting for REC Staff approval.
        </p>
      ) : null}
      {children}
    </AppShell>
  );
}
