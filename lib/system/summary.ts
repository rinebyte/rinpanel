import { db } from "@/db";
import { domains } from "@/db/schema";
import { runOnTarget } from "@/lib/shell";

export interface SystemSummary {
  totalDomains: number;
  sslOn: number;
  sslCoveragePct: number;
  totalMb: number;
  top: Array<{ domain: string; sizeMb: number }>;
}

export async function getSystemSummary(): Promise<SystemSummary> {
  const all = db.select().from(domains).all();
  const total = all.length;
  const sslOn = all.filter((d) => d.sslEnabled).length;
  const coveragePct = total > 0 ? Math.round((sslOn / total) * 100) : 0;

  let sizes: Array<{ domain: string; sizeMb: number }> = [];
  let totalMb = 0;
  if (total > 0) {
    // One `du` call covers everything under /var/www; we filter by registered
    // domain names so non-vhost folders (e.g. html) are excluded.
    const known = new Set(all.map((d) => d.domain));
    const r = await runOnTarget(["du", "-sm", "--max-depth=1", "/var/www"]);
    if (r.success) {
      sizes = r.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("\t");
          const sizeMb = parseInt(parts[0], 10) || 0;
          const name = (parts[1] ?? "").split("/").pop() ?? "";
          return { domain: name, sizeMb };
        })
        .filter((row) => known.has(row.domain));
      totalMb = sizes.reduce((a, b) => a + b.sizeMb, 0);
      sizes.sort((a, b) => b.sizeMb - a.sizeMb);
    }
  }

  return {
    totalDomains: total,
    sslOn,
    sslCoveragePct: coveragePct,
    totalMb,
    top: sizes.slice(0, 3),
  };
}
