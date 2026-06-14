"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Download } from "lucide-react";
import {
  checkForUpdates,
  startUpdate,
  type UpdateInfo,
  type UpdateStartResult,
} from "@/app/(dashboard)/update-actions";

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<string, string> = {
  pulling: "Mengambil pembaruan",
  installing: "Memasang dependensi",
  building: "Membangun aplikasi",
  migrating: "Memperbarui database",
  restarting: "Memulai ulang layanan",
  ok: "Pembaruan terakhir berhasil",
  failed: "Pembaruan terakhir gagal",
};

export function UpdateCard({ initial }: { initial: UpdateInfo }) {
  const [info, setInfo] = useState<UpdateInfo>(initial);
  const [checking, startCheck] = useTransition();
  const [updating, startUpdating] = useTransition();
  const [updateResult, setUpdateResult] = useState<UpdateStartResult | null>(null);
  const [kicked, setKicked] = useState(false);

  const handleCheck = () => {
    startCheck(async () => {
      const next = await checkForUpdates();
      setInfo(next);
    });
  };

  const handleUpdate = () => {
    if (!confirm("Memulai pembaruan panel. Panel akan dimulai ulang dalam beberapa menit. Lanjutkan?")) return;
    startUpdating(async () => {
      const r = await startUpdate();
      setUpdateResult(r);
      if (r.ok) setKicked(true);
    });
  };

  const liveStatus = STATUS_LABEL[info.lastStatus ?? ""] ?? null;
  const isRunning = info.lastStatus && ["pulling", "installing", "building", "migrating", "restarting"].includes(info.lastStatus);

  return (
    <section className="glass corner-ticks relative flex flex-col gap-4 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">pembaruan panel</p>
          <h2 className="font-display mt-1 text-lg font-bold tracking-wide text-white">Versi {info.currentSha ?? "—"}</h2>
          <p className="mt-0.5 font-mono text-[0.7rem] text-zinc-500">{formatDate(info.currentDate)}</p>
        </div>
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking || updating}
          className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 font-mono text-[0.7rem] tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Memeriksa" : "Periksa"}
        </button>
      </div>

      {!info.ok && info.error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
          {info.error}
        </p>
      )}

      {info.ok && info.upToDate && !kicked && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Panel sudah menggunakan versi terbaru.
        </p>
      )}

      {info.ok && !info.upToDate && info.commits && info.commits.length > 0 && !kicked && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-300">
            Tersedia {info.behind} pembaruan baru
            {info.latestSha && <> · versi {info.latestSha}</>}.
          </div>
          <ul className="max-h-40 overflow-auto rounded-md border border-white/5 bg-black/30 p-3 font-mono text-[0.7rem] text-zinc-300">
            {info.commits.map((c) => {
              const space = c.indexOf(" ");
              const sha = space > 0 ? c.slice(0, space) : c;
              const msg = space > 0 ? c.slice(space + 1) : "";
              return (
                <li key={sha} className="flex gap-2 leading-relaxed">
                  <span className="text-lime-500/70">{sha}</span>
                  <span className="text-zinc-300">{msg}</span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            className="accent-glow flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 font-mono text-xs font-bold tracking-wide uppercase text-primary-foreground disabled:opacity-60"
          >
            <Download className="size-4" />
            {updating ? "Memulai pembaruan…" : "Perbarui Sekarang"}
          </button>
        </div>
      )}

      {kicked && updateResult?.ok && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-300">
          <p>Pembaruan dimulai. Panel akan dimulai ulang dalam beberapa menit.</p>
          <p className="text-amber-200/80">Mohon segarkan halaman ini setelah selesai (Ctrl+R / Cmd+R).</p>
        </div>
      )}

      {updateResult && !updateResult.ok && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
          Gagal memulai pembaruan: {updateResult.error}
        </p>
      )}

      {liveStatus && isRunning && !kicked && (
        <p className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 font-mono text-xs text-sky-300">
          <span className="animate-blink">[ ·· ]</span> {liveStatus}…
        </p>
      )}
    </section>
  );
}
