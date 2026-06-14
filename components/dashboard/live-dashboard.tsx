"use client";

import { usePolling } from "@/lib/hooks/use-polling";
import type { SystemMetrics } from "@/lib/system/metrics";
import { StatusDot } from "./status-dot";
import { StatTile } from "./stat-tile";
import { UsageBar } from "./usage-bar";

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export function LiveDashboard() {
  const { data, error, loading } = usePolling<SystemMetrics>("/api/system/metrics", 3000);
  const state = error ? "error" : loading ? "loading" : "live";
  const unreachable = !!data && data.errors.length > 0 && data.cpu === null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">module 01 · telemetry</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">
            {data?.hostname ?? "—"}
          </h1>
        </div>
        <StatusDot state={state} />
      </div>

      {unreachable && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 font-mono text-sm text-red-300">
          Server tidak dapat dijangkau saat ini. Silakan periksa kembali kondisi server Anda.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="CPU" code="%">
          {data?.cpu ? <UsageBar pct={data.cpu.usagePct} /> : <Dash />}
        </StatTile>
        <StatTile label="Memory" code="MB">
          {data?.memory ? (
            <div className="flex flex-col gap-1.5">
              <UsageBar pct={data.memory.usagePct} />
              <span className="font-mono text-xs text-zinc-500">{data.memory.usedMb} / {data.memory.totalMb} MB</span>
            </div>
          ) : <Dash />}
        </StatTile>
        <StatTile label="Disk" code={data?.disk?.mount ?? "/"}>
          {data?.disk ? (
            <div className="flex flex-col gap-1.5">
              <UsageBar pct={data.disk.usagePct} />
              <span className="font-mono text-xs text-zinc-500">{(data.disk.usedKb / 1048576).toFixed(1)} / {(data.disk.sizeKb / 1048576).toFixed(1)} GB</span>
            </div>
          ) : <Dash />}
        </StatTile>
        <StatTile label="Load · Uptime">
          {data?.load && data.uptimeSec != null ? (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-2xl font-bold tabular-nums text-lime-400">{data.load.one.toFixed(2)}</span>
              <span className="font-mono text-xs text-zinc-500">{data.load.five.toFixed(2)} · {data.load.fifteen.toFixed(2)} · up {fmtUptime(data.uptimeSec)}</span>
            </div>
          ) : <Dash />}
        </StatTile>
      </div>
    </section>
  );
}

function Dash() {
  return <span className="font-mono text-2xl text-zinc-700">—</span>;
}
