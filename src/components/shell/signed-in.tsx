import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
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
    if (error instanceof AppError && (error.code === "UNAUTHENTICATED" || error.code === "SUSPENDED")) {
      redirect(error.code === "SUSPENDED" ? "/sign-in?error=AccessDenied" : "/sign-in");
    }
    throw error;
  }
  const jar = await cookies();
  return (
    <AppShell
      collapsed={jar.get("sidebar")?.value === "rail"}
      pageTitle={pageTitle}
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
