import { desc } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, type ActivityLog } from "@/db/schema";

export function logActivity(action: string, detail?: string): void {
  db.insert(activityLogs).values({ action, detail: detail ?? null }).run();
}

export function getRecentActivity(limit = 20): ActivityLog[] {
  return db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(limit).all();
}
