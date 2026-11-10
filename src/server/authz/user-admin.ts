import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isBootstrapAdmin } from "@/server/auth/bootstrap";
import type { UserAdminFacts } from "@/server/authz/policy";
import { prisma } from "@/server/db";

type Db = Prisma.TransactionClient | PrismaClient;

/** A suspended or merged holder cannot sign in, so that grant does not end the bootstrap fallback. */
export const ACTIVE_SYSTEM_ADMIN = {
  revokedAt: null,
  role: { key: "SYSTEM_ADMIN" },
  user: { status: "ACTIVE" },
} satisfies Prisma.UserRoleWhereInput;

export async function userAdminFacts(userId: string, db: Db = prisma): Promise<UserAdminFacts> {
  const grants = await db.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { key: true } } },
  });
  const bootstrap = await isBootstrapAdmin(userId, db);
  const systemAdmin = await db.userRole.findFirst({ where: ACTIVE_SYSTEM_ADMIN, select: { id: true } });
  return {
    roleKeys: new Set(grants.map((grant) => grant.role.key)),
    bootstrap,
    systemAdminExists: Boolean(systemAdmin),
  };
}
