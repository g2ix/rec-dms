import "server-only";
import { headers } from "next/headers";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { normalizeEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { AuditAction } from "@/lib/audit-log";
import { prisma } from "@/server/db";
import { audit, auditRequestMeta, diffOf, recordAudit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { createRecAdapter } from "@/server/auth/adapter";
import { authConfig } from "@/server/auth.config";
import { clearLinkIntent, readLinkIntent } from "@/server/auth/link-intent";
import { findOrStartSelfMerge } from "@/server/auth/linking";
import { clientIp, rateLimiter, SIGN_IN_LIMIT } from "@/server/auth/rate-limit";
import { authenticatePassword } from "@/server/auth/register";
import { ensureVerifiedEmail } from "@/server/auth/users";

async function profileEmail(profile: unknown, fallback?: string | null): Promise<string | null> {
  if (profile && typeof profile === "object" && "email" in profile && typeof profile.email === "string") {
    return profile.email;
  }
  return fallback ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: createRecAdapter(),
  providers: [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            authorization: { params: { prompt: "select_account" } },
          }),
        ]
      : []),
    Nodemailer({
      server: env.SMTP_URL,
      from: env.EMAIL_FROM,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const headerList = new Headers(request?.headers);
        const email = normalizeEmail(String(credentials?.email ?? ""));
        const failed = (reason: string) =>
          recordAudit(
            {
              action: AuditAction.signInFailed,
              entityType: "user",
              entityId: email || "unknown",
              meta: { reason, email },
            },
            headerList,
          );
        const hit = await rateLimiter.hit(`signin:${clientIp(headerList)}`, SIGN_IN_LIMIT.limit, SIGN_IN_LIMIT.windowMs);
        if (!hit.ok) {
          await failed("rate_limited");
          return null;
        }
        try {
          const user = await authenticatePassword(email, String(credentials?.password ?? ""));
          if (!user) {
            await failed("invalid_credentials");
            return null;
          }
          return { id: user.id, email: user.email ?? undefined };
        } catch (error) {
          if (error instanceof AppError && error.code === "SUSPENDED") {
            await failed("suspended");
            return null;
          }
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account }) {
      const userId = user?.id ?? (typeof token.userId === "string" ? token.userId : undefined) ?? token.sub;
      if (userId) {
        token.sub = String(userId);
        token.userId = String(userId);
      }
      if (user) {
        const signedInEmail = typeof user.email === "string" ? normalizeEmail(user.email) : null;
        let view: string | null = null;
        if (account && account.provider !== "credentials" && account.providerAccountId) {
          const linked = await prisma.account.findUnique({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
            },
            select: { defaultView: true, email: true },
          });
          view = linked?.defaultView ?? null;
          if (!view && linked?.email) {
            const emailRow = await prisma.userEmail.findUnique({
              where: { email: normalizeEmail(linked.email) },
              select: { defaultView: true },
            });
            view = emailRow?.defaultView ?? null;
          }
        }
        if (!view && signedInEmail) {
          const emailRow = await prisma.userEmail.findUnique({
            where: { email: signedInEmail },
            select: { defaultView: true },
          });
          view = emailRow?.defaultView ?? null;
        }
        token.identityDefaultView = view;
      }
      if (userId) {
        const row = await prisma.user.findUnique({
          where: { id: String(userId) },
          select: { status: true, mergedIntoId: true },
        });
        token.status = !row || row.mergedIntoId ? "MERGED" : row.status;
      }
      return token;
    },
    async signIn({ user, account, profile, email }) {
      if (account?.provider !== "credentials") {
        const headerList = await headers();
        const hit = await rateLimiter.hit(
          `signin:${clientIp(headerList)}`,
          SIGN_IN_LIMIT.limit,
          SIGN_IN_LIMIT.windowMs,
        );
        if (!hit.ok) return "/sign-in?error=RateLimited";
      }

      if (email?.verificationRequest) {
        const existing = user.email
          ? await prisma.userEmail.findFirst({
              where: {
                email: normalizeEmail(user.email),
                verifiedAt: { not: null },
                user: { status: { notIn: ["MERGED", "SUSPENDED"] }, mergedIntoId: null },
              },
            })
          : null;
        return existing ? true : "/sign-in?sent=1";
      }

      const intent = await readLinkIntent();
      if (intent && account && account.provider !== "credentials") {
        const owner = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
        });
        const sharedEmail = await profileEmail(profile, user.email);
        const emailOwner = sharedEmail
          ? await prisma.userEmail.findUnique({ where: { email: normalizeEmail(sharedEmail) } })
          : null;
        const otherUserId =
          owner && owner.userId !== intent.userId
            ? owner.userId
            : emailOwner && emailOwner.userId !== intent.userId
              ? emailOwner.userId
              : null;
        if (otherUserId) {
          const session = await findOrStartSelfMerge(intent.userId, otherUserId);
          await clearLinkIntent();
          return `/app/account/merge/${session.id}`;
        }
        return true;
      }

      if (user.id) {
        const row = await prisma.user.findUnique({ where: { id: user.id } });
        if (row?.status === "SUSPENDED") {
          await recordAudit({
            actorUserId: user.id,
            action: AuditAction.signInFailed,
            entityType: "user",
            entityId: user.id,
            meta: { reason: "suspended" },
          });
          return "/sign-in?error=Suspended";
        }
        if (row && (row.status === "MERGED" || row.mergedIntoId)) {
          await recordAudit({
            actorUserId: user.id,
            action: AuditAction.signInFailed,
            entityType: "user",
            entityId: user.id,
            meta: { reason: "merged" },
          });
          return "/sign-in?error=AccessDenied";
        }
      }
      return true;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (!user.id) return;
      await recordAudit({
        actorUserId: user.id,
        action: AuditAction.signIn,
        entityType: "user",
        entityId: user.id,
        meta: { provider: account?.provider ?? "credentials" },
      });
    },
    async signOut(message) {
      const token = message && "token" in message ? message.token : null;
      const userId =
        token && typeof token.userId === "string"
          ? token.userId
          : token && typeof token.sub === "string"
            ? token.sub
            : null;
      if (!userId) return;
      await recordAudit({
        actorUserId: userId,
        action: AuditAction.signOut,
        entityType: "user",
        entityId: userId,
      });
    },
    async linkAccount({ user, account, profile }) {
      const email = await profileEmail(profile, user.email);
      if (!user.id || !email) return;
      const normalized = normalizeEmail(email);
      const meta = await auditRequestMeta({ provider: account.provider, email: normalized });
      await prisma.$transaction(async (tx) => {
        await ensureVerifiedEmail(user.id!, normalized, tx);
        const linked = await tx.account.update({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
          data: { email: normalized },
        });
        await audit.record(tx, {
          actorUserId: user.id,
          action: AuditAction.identityLinked,
          entityType: "account",
          entityId: linked.id,
          diff: diffOf({}, { provider: account.provider, email: normalized }),
          meta,
        });
      });
      await clearLinkIntent();
    },
  },
});
