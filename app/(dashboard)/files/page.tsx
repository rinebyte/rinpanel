import { desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { domains } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const rows = db.select().from(domains).orderBy(desc(domains.createdAt)).all();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">module 03 · files</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">webroots</h1>
        </div>
        <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 font-mono text-[0.65rem] tracking-wide uppercase text-lime-300">
          {rows.length} vhosts
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="glass corner-ticks relative rounded-xl p-8 text-center">
          <p className="eyebrow">no domains configured</p>
          <p className="mt-2 font-mono text-sm text-zinc-500">
            tambahin di <Link href="/domains" className="text-lime-300 underline">/domains</Link> dulu
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/files/${r.domain}`}
                className="glass corner-ticks relative flex flex-col gap-2 rounded-xl p-5 hover:bg-white/[0.02]"
              >
                <span className="eyebrow">webroot</span>
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
