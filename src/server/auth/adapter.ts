import "server-only";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { statusForEmail } from "@/lib/approval";
import { splitPersonName } from "@/lib/display-name";
import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";
import { autoApproveDomains } from "@/server/auth/domains";
import { userForProviderAccount } from "@/server/auth/linking";
import { createPerson } from "@/server/auth/users";
import { bindInvitesForEmail } from "@/server/protocols/invites";

type NamedUser = {
  id: string;
  email: string | null;
  emailVerified: Date | null;
  displayName: string;
  image: string | null;
};

function toAdapterUser(user: NamedUser): AdapterUser {
  return {
    id: user.id,
    email: user.email ?? "",
    emailVerified: user.emailVerified,
    name: user.displayName,
    image: user.image,
  };
}

export function createRecAdapter(db: PrismaClient = prisma): Adapter {
  const base = PrismaAdapter(db);
  return {
    ...base,
    async getUser(id) {
      const user = await db.user.findUnique({ where: { id } });
      if (!user || user.status === "MERGED" || user.status === "SUSPENDED" || user.mergedIntoId) return null;
      return toAdapterUser(user);
    },
    async getUserByEmail(email) {
      const row = await db.userEmail.findFirst({
        where: {
          email: normalizeEmail(email),
          verifiedAt: { not: null },
          user: { status: { notIn: ["MERGED", "SUSPENDED"] }, mergedIntoId: null },
        },
        include: { user: true },
      });
      return row ? toAdapterUser(row.user) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const user = await userForProviderAccount(provider, providerAccountId);
      return user ? toAdapterUser(user) : null;
    },
    async createUser(data) {
      const profile = data as AdapterUser & { givenName?: string; familyName?: string };
      if (!profile.email) throw new Error("The sign-in provider did not share an email address.");
      const names =
        profile.givenName && profile.familyName
          ? { firstName: profile.givenName, middleInitial: null, familyName: profile.familyName }
          : splitPersonName(profile.name);
      const domains = await autoApproveDomains();
      const user = await createPerson(
        {
          ...names,
          email: profile.email,
          status: statusForEmail(profile.email, domains),
          image: profile.image,
        },
        db,
      );
      return toAdapterUser(user);
    },
    async updateUser({ id, emailVerified, name, image }) {
      const user = await db.user.update({
        where: { id },
        data: {
          emailVerified: emailVerified ?? undefined,
          name: name ?? undefined,
          image: image === undefined ? undefined : image,
        },
      });
      if (emailVerified && user.email) {
        await db.userEmail.updateMany({
          where: { userId: id, email: user.email, verifiedAt: null },
          data: { verifiedAt: emailVerified },
        });
        await bindInvitesForEmail(id, user.email, db);
      }
      return toAdapterUser(user);
    },
  };
}
