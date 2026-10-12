import NextAuth from "next-auth";
import { recordAuditEvent } from "@/platform/audit/with-audit";
import { buildProviders, DEV_LOGIN_PROVIDER_ID } from "./config";
import { authorizeDevLogin } from "./dev-login";
import { findAuthUserByEmail } from "./users";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: buildProviders((credentials) => authorizeDevLogin(credentials)),
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    // SSO users must already be provisioned in the database (deny by default).
    async signIn({ user, account }) {
      if (account?.provider === DEV_LOGIN_PROVIDER_ID) return Boolean(user?.id);
      if (!user?.email) return false;
      return (await findAuthUserByEmail(user.email)) !== null;
    },
    async jwt({ token, user, account }) {
      if (user && account) {
        if (account.provider === DEV_LOGIN_PROVIDER_ID) {
          token.uid = user.id;
        } else if (user.email) {
          token.uid = (await findAuthUserByEmail(user.email))?.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      const dbUser = user.email ? await findAuthUserByEmail(user.email) : null;
      if (!dbUser) return;
      await recordAuditEvent({
        actor: { id: dbUser.id, email: dbUser.email },
        action: "auth.sign_in",
        entityType: "User",
        entityId: dbUser.id,
        metadata: { provider: account?.provider ?? "unknown" },
      });
    },
  },
});
