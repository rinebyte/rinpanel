import type { ActivityLog } from "@/db/schema";

export function ActivityLogView({ entries }: { entries: ActivityLog[] }) {
  return (
    <div className="glass rounded-xl p-5">
      <span className="eyebrow">Activity · last 20</span>
      <ul className="mt-4 flex flex-col gap-2 border-l border-white/10 pl-4 font-mono text-sm">
        {entries.length === 0 && <li className="text-zinc-600">▸ no activity recorded</li>}
        {entries.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3">
            <span className="text-zinc-600">{new Date(e.createdAt).toLocaleTimeString()}</span>
            <span className={e.action === "login_failed" ? "text-amber-400" : "text-emerald-400"}>▸ {e.action}</span>
            {e.detail && <span className="truncate text-zinc-500">{e.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
