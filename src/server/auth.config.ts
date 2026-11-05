import type { NextAuthConfig } from "next-auth";

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
    authorized({ auth }) {
      return Boolean(auth?.user?.id);
    },
    jwt({ token, user }) {
      const userId = user?.id ?? (typeof token.userId === "string" ? token.userId : undefined) ?? token.sub;
      if (!userId) return token;
      return { sub: userId, userId };
    },
    session({ session, token }) {
      session.user.id = String(token.userId ?? token.sub ?? "");
      return session;
    },
  },
} satisfies NextAuthConfig;
