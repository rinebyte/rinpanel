function gradeClasses(pct: number): { text: string; bar: string } {
  if (pct >= 80) return { text: "text-red-400", bar: "bg-red-500" };
  if (pct >= 60) return { text: "text-amber-400", bar: "bg-amber-500" };
  if (pct >= 40) return { text: "text-sky-400", bar: "bg-sky-500" };
  return { text: "text-emerald-400", bar: "bg-emerald-500" };
}

export function UsageBar({ pct }: { pct: number }) {
  const g = gradeClasses(pct);
  return (
    <div className="flex flex-col gap-1.5">
      <span className={`font-mono text-2xl font-bold tabular-nums ${g.text}`}>{pct.toFixed(1)}%</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/5">
        <div className={`h-full rounded-full ${g.bar}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}
