import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { knownRoleView } from "@/lib/role-view";
import { signOut } from "@/server/auth";
import { AppError } from "@/server/errors";
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
  const roleView = knownRoleView(jar.get("activeView")?.value) ?? "proponent";
  return (
    <AppShell
      collapsed={jar.get("sidebar")?.value === "rail"}
      pageTitle={pageTitle}
      roleView={roleView}
      account={{ name: user.displayName, email: user.email ?? "" }}
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
