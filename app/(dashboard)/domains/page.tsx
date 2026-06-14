import { desc } from "drizzle-orm";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { CreateForm } from "@/components/domains/create-form";
import { DomainRow } from "@/components/domains/domain-row";
import { detectSslProvider } from "@/lib/nginx/ssl-detect";
import type { SslProvider } from "@/lib/nginx/ssl-detect";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const rows = db.select().from(domains).orderBy(desc(domains.createdAt)).all();
  const sslEmail = process.env.LETS_ENCRYPT_EMAIL ?? "";
  const sslDryRun = process.env.CERTBOT_DRY_RUN !== "false";

  // Detect provider per row. Each cap at 3s; cached for 5min per domain in the module.
  // Use Promise.allSettled so one slow/failing lookup doesn't block the others.
  const providers = await Promise.all(
    rows.map(async (r): Promise<SslProvider> => {
      try {
        return await detectSslProvider(r.domain);
      } catch {
        return "unknown";
      }
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">module 02 · domains</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">Domain</h1>
        </div>
        <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 font-mono text-[0.65rem] tracking-wide uppercase text-lime-300">
          {rows.length} aktif
        </span>
      </header>

      <CreateForm />

      {rows.length === 0 ? (
        <div className="glass corner-ticks relative rounded-xl p-8 text-center">
          <p className="eyebrow">belum ada domain</p>
          <p className="mt-2 font-mono text-sm text-zinc-500">Silakan tambahkan domain pertama Anda melalui formulir di atas.</p>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-xl">
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 px-5 py-3">
            <span className="eyebrow">nama domain</span>
            <span className="eyebrow">tindakan</span>
          </div>
          <ul className="divide-y divide-white/5">
            {rows.map((r, i) => (
              <DomainRow key={r.id} row={r} sslEmail={sslEmail} sslDryRun={sslDryRun} sslProvider={providers[i]} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
