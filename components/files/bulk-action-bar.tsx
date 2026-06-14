"use client";

import { useState, useTransition } from "react";
import { Download, Trash, ArrowUp, X } from "lucide-react";
import { deleteEntries, moveEntries } from "@/app/(dashboard)/files/actions";

interface Props {
  domain: string;
  cwd: string;
  paths: string[];
  onClear: () => void;
}

export function BulkActionBar({ domain, cwd, paths, onClear }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    if (!confirm(`Hapus ${paths.length} berkas terpilih? Folder akan dihapus beserta seluruh isinya.`)) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("domain", domain);
      for (const p of paths) fd.append("paths", p);
      const r = await deleteEntries(fd);
      if (!r.ok) setError(r.error ?? "Gagal menghapus.");
      else onClear();
    });
  };

  const handleMoveUp = () => {
    if (!cwd) {
      setError("Sudah berada di folder paling atas.");
      return;
    }
    const parent = cwd.split("/").slice(0, -1).join("/");
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("domain", domain);
      fd.set("dest", parent);
      for (const p of paths) fd.append("paths", p);
      const r = await moveEntries(fd);
      if (!r.ok) setError(r.error ?? "Gagal memindahkan.");
      else onClear();
    });
  };

  const handleZip = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/files/${domain}/zip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths }),
        });
        if (!res.ok) {
          const t = await res.text();
          setError(`Gagal mengunduh ZIP: ${t || res.statusText}`);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const filename = paths.length === 1
          ? `${paths[0].split("/").pop()}.zip`
          : `${domain}-berkas.zip`;
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        setError((e as Error).message || "Gagal mengunduh ZIP.");
      }
    });
  };

  return (
    <div className="glass corner-ticks relative flex flex-col gap-3 rounded-xl border border-lime-500/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="rounded-md border border-lime-500/30 bg-lime-500/10 px-2 py-1 font-mono text-xs text-lime-300">
            {paths.length} dipilih
          </span>
          <button
            type="button"
            onClick={onClear}
            className="flex h-7 items-center gap-1 rounded-md px-2 font-mono text-[0.7rem] tracking-wide uppercase text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-3.5" />
            Batal
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleMoveUp}
            disabled={pending || !cwd}
            className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 font-mono text-[0.7rem] tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white disabled:opacity-50"
          >
            <ArrowUp className="size-3.5" />
            Pindah ke Induk
          </button>
          <button
            type="button"
            onClick={handleZip}
            disabled={pending}
            className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 font-mono text-[0.7rem] tracking-wide uppercase text-zinc-300 hover:border-sky-500/30 hover:bg-sky-500/10 hover:text-sky-300 disabled:opacity-50"
          >
            <Download className="size-3.5" />
            Unduh ZIP
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="flex h-9 items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 font-mono text-[0.7rem] font-semibold tracking-wide uppercase text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          >
            <Trash className="size-3.5" />
            Hapus
          </button>
        </div>
      </div>

      {pending && (
        <p className="font-mono text-xs text-zinc-400">
          <span className="animate-blink">[ ·· ]</span> Memproses...
        </p>
      )}

      {error && (
        <pre className="overflow-auto rounded border border-red-500/30 bg-red-500/10 p-2 font-mono text-[0.7rem] text-red-200/90">
          {error}
        </pre>
      )}
    </div>
  );
}
