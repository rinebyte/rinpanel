export function StatTile({ label, code, children }: { label: string; code?: string; children: React.ReactNode }) {
  return (
    <div className="glass corner-ticks relative flex flex-col gap-3 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {code && <span className="eyebrow text-zinc-600">{code}</span>}
      </div>
      {children}
    </div>
  );
}
