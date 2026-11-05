import "server-only";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status === "MERGED" || user.mergedIntoId) {
    throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }
  if (user.status === "SUSPENDED") {
    throw new AppError("SUSPENDED", "This account is suspended.", 403);
  }
  return user;
}

export async function requireActiveUser() {
  const user = await requireUser();
  if (user.status !== "ACTIVE") {
    throw new AppError(
      "PENDING_APPROVAL",
      "Your account is waiting for REC Staff approval.",
      403,
    );
  }
  return user;
}
