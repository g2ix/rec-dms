import "server-only";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export function bootstrapAdminEmails(source = process.env.BOOTSTRAP_ADMIN_EMAILS ?? ""): string[] {
  return source
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function isBootstrapAdmin(userId: string): Promise<boolean> {
  const allowed = new Set(bootstrapAdminEmails());
  if (allowed.size === 0) return false;
  const emails = await prisma.userEmail.findMany({
    where: { userId, verifiedAt: { not: null } },
  });
  return emails.some((email) => allowed.has(email.email));
}

export async function assertBootstrapAdmin(userId: string): Promise<void> {
  if (!(await isBootstrapAdmin(userId))) {
    throw new AppError("FORBIDDEN", "Only a bootstrap administrator can do this.", 403);
  }
}
