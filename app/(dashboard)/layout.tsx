import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { activityLogs } from "@/db/schema";
import { Sidebar } from "@/components/app-shell/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  // Show the PREVIOUS login (one before the current session).
  const username = session.user?.name ?? "admin";
  const recent = db
    .select()
    .from(activityLogs)
    .where(and(eq(activityLogs.action, "login_success"), eq(activityLogs.detail, username)))
    .orderBy(desc(activityLogs.createdAt))
    .limit(2)
    .all();
  const lastLoginAt = recent[1]?.createdAt ?? null;

  return (
    <div className="relative z-10 flex min-h-screen">
      <Sidebar lastLoginAt={lastLoginAt} />
      <main className="flex-1 overflow-x-hidden p-4 md:p-8">{children}</main>
    </div>
  );
}
