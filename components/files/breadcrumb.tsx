import Link from "next/link";

export function Breadcrumb({ domain, relPath }: { domain: string; relPath: string }) {
  const segments = relPath.split("/").filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="font-mono text-base text-zinc-200 flex flex-wrap items-baseline gap-1">
        <Link href="/files" className="text-lime-500/70 hover:text-lime-300">▸</Link>
        <Link href="/files" className="text-zinc-500 hover:text-white">Berkas</Link>
        <span className="text-zinc-700">·</span>
        <Link href={`/files/${domain}`} className="text-white font-display tracking-wide hover:text-lime-300">
          {domain}
        </Link>
        {segments.map((seg, i) => {
          const sub = segments.slice(0, i + 1).join("/");
          return (
            <span key={sub} className="flex items-baseline gap-1">
              <span className="text-zinc-700">/</span>
              <Link href={`/files/${domain}/${sub}`} className="text-zinc-300 hover:text-white">{seg}</Link>
            </span>
          );
        })}
      </h1>
      <Link
        href="/domains"
        className="font-mono text-[0.65rem] tracking-wider text-zinc-500 uppercase hover:text-lime-400"
      >
        ▸ Atur Domain
      </Link>
    </div>
  );
}
