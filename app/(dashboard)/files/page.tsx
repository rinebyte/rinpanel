import { desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { DomainPicker } from "@/components/files/domain-picker";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const rows = db.select().from(domains).orderBy(desc(domains.createdAt)).all();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">module 03 · files</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">Berkas</h1>
        </div>
        <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 font-mono text-[0.65rem] tracking-wide uppercase text-lime-300">
          {rows.length} domain
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="glass corner-ticks relative rounded-xl p-8 text-center">
          <p className="eyebrow">belum ada domain</p>
          <p className="mt-2 font-mono text-sm text-zinc-500">
            Silakan tambahkan domain terlebih dahulu melalui menu <Link href="/domains" className="text-lime-300 underline">Domain</Link>.
          </p>
        </div>
      ) : (
        <DomainPicker rows={rows.map((r) => ({ id: r.id, domain: r.domain, rootPath: r.rootPath }))} />
      )}
    </div>
  );
}
