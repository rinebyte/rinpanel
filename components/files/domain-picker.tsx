"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

export interface PickerRow {
  id: string;
  domain: string;
  rootPath: string;
}

export function DomainPicker({ rows }: { rows: PickerRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.domain.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex items-center gap-3 rounded-xl px-5 py-3">
        <Search className="size-4 shrink-0 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="cari domain..."
          className="h-7 w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-600"
        />
        {query && (
          <span className="shrink-0 font-mono text-[0.7rem] text-zinc-500">
            {filtered.length} dari {rows.length}
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="glass corner-ticks relative rounded-xl p-8 text-center">
          <p className="eyebrow">tidak ada hasil</p>
          <p className="mt-2 font-mono text-sm text-zinc-500">
            Tidak ada domain yang cocok dengan &quot;{query}&quot;.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <li key={r.id}>
              <Link
                href={`/files/${r.domain}`}
                className="glass corner-ticks relative flex flex-col gap-2 rounded-xl p-5 hover:bg-white/[0.02]"
              >
                <span className="eyebrow">folder</span>
                <span className="truncate font-mono text-sm text-white">{r.domain}</span>
                <span className="truncate font-mono text-[0.7rem] text-zinc-500">▸ {r.rootPath}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
