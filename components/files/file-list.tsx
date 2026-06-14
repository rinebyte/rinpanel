import type { Entry } from "@/lib/fs/files";
import { FileRow } from "./file-row";

export function FileList({ domain, cwd, entries }: { domain: string; cwd: string; entries: Entry[] }) {
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-white/10 px-5 py-3">
        <span className="eyebrow">nama</span>
        <span className="eyebrow text-right">ukuran</span>
        <span className="eyebrow text-right">diperbarui</span>
        <span className="eyebrow">tindakan</span>
      </div>
      <ul className="divide-y divide-white/5">
        {sorted.length === 0 ? (
          <li className="px-5 py-8 text-center font-mono text-sm text-zinc-500">
            Belum ada berkas di folder ini. Silakan unggah melalui area di atas.
          </li>
        ) : (
          sorted.map((e) => (
            <FileRow key={e.name} domain={domain} cwd={cwd} entry={e} />
          ))
        )}
      </ul>
    </div>
  );
}
