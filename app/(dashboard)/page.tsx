import { getRecentActivity } from "@/lib/system/activity";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { ActivityLogView } from "@/components/dashboard/activity-log";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const activity = getRecentActivity(20);
  return (
    <div className="flex flex-col gap-6">
      <LiveDashboard />
      <ActivityLogView entries={activity} />
    </div>
  );
}
