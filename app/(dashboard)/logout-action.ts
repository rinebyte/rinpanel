"use server";

import { auth, signOut } from "@/auth";
import { logActivity } from "@/lib/system/activity";

export async function logout(): Promise<void> {
  const session = await auth();
  if (session?.user?.name) logActivity("logout", session.user.name);
  await signOut({ redirectTo: "/login" });
}
