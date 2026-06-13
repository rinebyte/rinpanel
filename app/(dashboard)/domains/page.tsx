import { desc } from "drizzle-orm";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { CreateForm } from "@/components/domains/create-form";
import { DomainRow } from "@/components/domains/domain-row";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const rows = db.select().from(domains).orderBy(desc(domains.createdAt)).all();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">module 02 · domains</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">vhosts</h1>
        </div>
        <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 font-mono text-[0.65rem] tracking-wide uppercase text-lime-300">
          {rows.length} active
        </span>
      </header>

      <CreateForm />

      {rows.length === 0 ? (
        <div className="glass corner-ticks relative rounded-xl p-8 text-center">
          <p className="eyebrow">no domains configured</p>
          <p className="mt-2 font-mono text-sm text-zinc-500">tambahin domain pertama lewat form di atas</p>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-xl">
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 px-5 py-3">
            <span className="eyebrow">domain</span>
            <span className="eyebrow">actions</span>
          </div>
          <ul className="divide-y divide-white/5">
            {rows.map((r) => (
              <DomainRow key={r.id} row={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
