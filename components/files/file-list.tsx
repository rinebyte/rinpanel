"use client";

import { useState, useMemo, useTransition } from "react";
import { Search } from "lucide-react";
import type { Entry } from "@/lib/fs/files";
import { FileRow } from "./file-row";
import { BulkActionBar } from "./bulk-action-bar";
import { moveEntries } from "@/app/(dashboard)/files/actions";

const DRAG_MIME = "application/x-rinpanel-paths";

export function FileList({ domain, cwd, entries }: { domain: string; cwd: string; entries: Entry[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
    return [...base].sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [entries, query]);

  const toRelPath = (name: string) => (cwd ? `${cwd}/${name}` : name);
  const selectedPaths = Array.from(selected).map(toRelPath);

  const allVisibleNames = filtered.map((e) => e.name);
  const allSelected = allVisibleNames.length > 0 && allVisibleNames.every((n) => selected.has(n));

  const toggle = (name: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allVisibleNames));
  };

  const handleDragStart = (e: React.DragEvent, name: string) => {
    const items = selected.has(name) && selected.size > 0 ? Array.from(selected) : [name];
    const paths = items.map(toRelPath);
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnDir = (e: React.DragEvent, destName: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let paths: string[];
    try { paths = JSON.parse(raw); } catch { return; }
    const destRel = toRelPath(destName);
    if (paths.includes(destRel)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("domain", domain);
      fd.set("dest", destRel);
      for (const p of paths) fd.append("paths", p);
      const r = await moveEntries(fd);
      if (!r.ok) alert(`Gagal memindahkan: ${r.error ?? "tidak diketahui"}`);
      else setSelected(new Set());
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {selected.size > 0 && (
        <BulkActionBar
          domain={domain}
          cwd={cwd}
          paths={selectedPaths}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="glass overflow-hidden rounded-xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <Search className="size-4 shrink-0 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="cari berkas di folder ini..."
            className="h-7 w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-600"
          />
          {query && (
            <span className="font-mono text-[0.7rem] text-zinc-500">
              {filtered.length} dari {entries.length}
            </span>
          )}
        </div>

        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 border-b border-white/10 px-5 py-3">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Pilih semua"
            className="size-4 accent-lime-500"
          />
          <span className="eyebrow">nama</span>
          <span className="eyebrow text-right">ukuran</span>
          <span className="eyebrow text-right">diperbarui</span>
          <span className="eyebrow">tindakan</span>
        </div>

        <ul className="divide-y divide-white/5">
          {filtered.length === 0 ? (
            <li className="px-5 py-8 text-center font-mono text-sm text-zinc-500">
              {query
                ? `Tidak ada berkas yang cocok dengan "${query}".`
                : "Belum ada berkas di folder ini. Silakan unggah melalui area di atas."}
            </li>
          ) : (
            filtered.map((e) => (
              <FileRow
                key={e.name}
                domain={domain}
                cwd={cwd}
                entry={e}
                selected={selected.has(e.name)}
                onToggle={() => toggle(e.name)}
                onDragStart={(ev) => handleDragStart(ev, e.name)}
                onDropDir={e.type === "dir" ? (ev) => handleDropOnDir(ev, e.name) : undefined}
              />
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
