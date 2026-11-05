import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthEntryPath, resolveStartPage, verificationEmail } from "@/lib/auth-redirect";
import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";
import { auth, signOut } from "@/server/auth";

export async function redirectAwayFromAuthEntry(pathname: string, search: string) {
  if (!isAuthEntryPath(pathname)) return;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, mergedIntoId: true },
  });
  if (!user || user.status === "MERGED" || user.mergedIntoId) {
    await signOut({ redirectTo: "/sign-in?error=AccessDenied" });
    return;
  }
  if (user.status === "SUSPENDED") {
    await signOut({ redirectTo: "/sign-in?error=Suspended" });
    return;
  }

  const email = verificationEmail(pathname, search);
  if (email && (await hasOpenVerification(userId, email))) return;

  const jar = await cookies();
  const start = resolveStartPage({
    identityDefaultView: session.user.identityDefaultView,
    lastUsedView: jar.get("activeView")?.value,
  });
  redirect(start.path);
}

async function hasOpenVerification(userId: string, email: string) {
  const row = await prisma.emailCode.findFirst({
    where: {
      email: normalizeEmail(email),
      purpose: { in: ["VERIFY_EMAIL", "LINK_EMAIL"] },
      consumedAt: null,
      expiresAt: { gt: new Date() },
      OR: [{ userId }, { userId: null }],
    },
    select: { id: true },
  });
  return Boolean(row);
}
