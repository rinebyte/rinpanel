import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { listDir } from "@/lib/fs/files";
import { Breadcrumb } from "@/components/files/breadcrumb";
import { MkdirForm } from "@/components/files/mkdir-form";
import { UploadZone } from "@/components/files/upload-zone";
import { FileList } from "@/components/files/file-list";

export const dynamic = "force-dynamic";

export default async function FileBrowserPage({
  params,
}: {
  params: Promise<{ domain: string; path?: string[] }>;
}) {
  const { domain, path = [] } = await params;
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  if (!row) notFound();

  const relPath = path.join("/");
  const r = await listDir(domain, relPath);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">module 03 · files</p>
        <Breadcrumb domain={domain} relPath={relPath} />
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <UploadZone domain={domain} cwd={relPath} />
        <MkdirForm domain={domain} cwd={relPath} />
      </div>

      {r.ok ? (
        <FileList domain={domain} cwd={relPath} entries={r.value.entries} />
      ) : (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 font-mono text-sm text-red-300">
          Gagal memuat berkas: {r.error}
        </div>
      )}
    </div>
  );
}
