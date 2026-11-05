import type { NextAuthConfig } from "next-auth";
import { safeInternalPath } from "@/lib/auth-redirect";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in?sent=1",
    error: "/sign-in",
  },
  providers: [],
  callbacks: {
    authorized() {
      return true;
    },
    redirect({ url, baseUrl }) {
      // Leave `/` alone. Middleware resolves the start page there: identity
      // default view, then the last used view, then `/app`.
      const path = safeInternalPath(url, baseUrl);
      return new URL(path, baseUrl).toString();
    },
    jwt({ token, user }) {
      const userId = user?.id ?? (typeof token.userId === "string" ? token.userId : undefined) ?? token.sub;
      if (!userId) return token;
      token.sub = String(userId);
      token.userId = String(userId);
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.userId ?? token.sub ?? "");
      session.user.status = typeof token.status === "string" ? token.status : undefined;
      session.user.identityDefaultView =
        typeof token.identityDefaultView === "string" ? token.identityDefaultView : null;
      return session;
    },
  },
} satisfies NextAuthConfig;
