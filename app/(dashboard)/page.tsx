import { getRecentActivity } from "@/lib/system/activity";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { ActivityLogView } from "@/components/dashboard/activity-log";
import { UpdateCard } from "@/components/dashboard/update-card";
import { checkForUpdates } from "./update-actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const activity = getRecentActivity(20);
  // First-render: best-effort show the current version without hitting the
  // network. checkForUpdates() also does a `git fetch` which can be slow;
  // wrap with a timeout so a hung network doesn't block the dashboard render.
  const updateInfo = await Promise.race([
    checkForUpdates(),
    new Promise<{ ok: false; error: string }>((res) =>
      setTimeout(() => res({ ok: false, error: "Status pembaruan tidak tersedia (timeout)." }), 4000),
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <LiveDashboard />
      <UpdateCard initial={updateInfo} />
      <ActivityLogView entries={activity} />
    </div>
  );
}
