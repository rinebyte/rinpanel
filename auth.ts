import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "./db";
import { users } from "./db/schema";
import { verifyPassword } from "./lib/auth/password";
import { logActivity } from "./lib/system/activity";

const credsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;
        const user = db.select().from(users).where(eq(users.username, username)).get();
        if (!user) {
          logActivity("login_failed", `unknown user: ${username}`);
          return null;
        }
        if (!verifyPassword(password, user.passwordHash)) {
          logActivity("login_failed", `bad password: ${username}`);
          return null;
        }
        logActivity("login_success", username);
        return { id: user.id, name: user.username };
      },
    }),
  ],
});
