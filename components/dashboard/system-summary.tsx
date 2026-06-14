import Link from "next/link";
import { Globe, ShieldCheck, HardDrive } from "lucide-react";
import type { SystemSummary } from "@/lib/system/summary";

function formatBytes(mb: number): { value: string; unit: string } {
  if (mb >= 1024) return { value: (mb / 1024).toFixed(1), unit: "GB" };
  return { value: String(mb), unit: "MB" };
}

export function SystemSummaryCard({ summary }: { summary: SystemSummary }) {
  const total = formatBytes(summary.totalMb);

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_1.4fr]">
      <Tile
        icon={Globe}
        label="Total Domain"
        value={String(summary.totalDomains)}
        sub={summary.totalDomains > 0 ? "vhost aktif" : "belum ada"}
        href="/domains"
      />
      <Tile
        icon={ShieldCheck}
        label="SSL Aktif"
        value={`${summary.sslOn}`}
        sub={`${summary.sslCoveragePct}% dari ${summary.totalDomains}`}
        href="/domains"
      />
      <div className="glass corner-ticks relative flex flex-col gap-3 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">penggunaan disk</span>
          <span className="font-mono text-[0.6rem] tracking-wider text-zinc-600 uppercase">
            /var/www
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <HardDrive className="size-4 text-zinc-500" />
          <span className="font-mono text-2xl font-bold tabular-nums text-white">{total.value}</span>
          <span className="font-mono text-xs text-zinc-500">{total.unit}</span>
        </div>
        {summary.top.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1">
            {summary.top.map((row) => {
              const s = formatBytes(row.sizeMb);
              return (
                <li key={row.domain} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/files/${row.domain}/public_html`}
                    className="truncate font-mono text-xs text-zinc-300 hover:text-lime-300"
                  >
                    ▸ {row.domain}
                  </Link>
                  <span className="font-mono text-xs text-zinc-500 tabular-nums">
                    {s.value} {s.unit}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="font-mono text-xs text-zinc-600">Belum ada data ukuran berkas.</p>
        )}
      </div>
    </section>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  href,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const body = (
    <div className="glass corner-ticks relative flex h-full flex-col gap-3 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <Icon className="size-4 text-zinc-500" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold tabular-nums text-lime-400">{value}</span>
      </div>
      {sub && <span className="font-mono text-[0.7rem] text-zinc-500">{sub}</span>}
    </div>
  );
  return href ? (
    <Link href={href} className="hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}
