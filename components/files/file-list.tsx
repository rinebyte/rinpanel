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
        <span className="eyebrow">name</span>
        <span className="eyebrow text-right">size</span>
        <span className="eyebrow text-right">modified</span>
        <span className="eyebrow">actions</span>
      </div>
      <ul className="divide-y divide-white/5">
        {sorted.length === 0 ? (
          <li className="px-5 py-8 text-center font-mono text-sm text-zinc-500">
            ▸ empty folder — drop files in the upload zone above
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
