export function StatusDot({ state }: { state: "live" | "error" | "loading" }) {
  const color = state === "live" ? "bg-emerald-400" : state === "error" ? "bg-red-400" : "bg-amber-400";
  const label = state === "live" ? "AKTIF" : state === "error" ? "TIDAK TERJANGKAU" : "MENGHUBUNGKAN";
  return (
    <span className="flex items-center gap-2 font-mono text-[0.65rem] tracking-wide text-zinc-400 uppercase">
      <span className={`size-1.5 rounded-full ${color} animate-glow-pulse`} />
      {label}
    </span>
  );
}
