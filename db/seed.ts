import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { db } from "./index";
import { users } from "./schema";
import { hashPassword } from "../lib/auth/password";

function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env.local");
  }
  const passwordHash = hashPassword(password);
  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) {
    db.update(users).set({ passwordHash }).where(eq(users.username, username)).run();
    console.log(`Updated admin user: ${username}`);
  } else {
    db.insert(users).values({ username, passwordHash }).run();
    console.log(`Created admin user: ${username}`);
  }
}

main();
