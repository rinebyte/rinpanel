import type { ActivityLog } from "@/db/schema";

const ACTION_LABEL: Record<string, string> = {
  login_success: "Berhasil masuk",
  login_failed: "Gagal masuk",
  logout: "Keluar",
  domain_create: "Domain ditambahkan",
  domain_delete: "Domain dihapus",
  domain_rename: "Domain diganti nama",
  domain_ssl_enable: "SSL diaktifkan",
  domain_ssl_disable: "SSL dinonaktifkan",
  domain_config_edit: "Konfigurasi disunting",
  domain_config_reset: "Konfigurasi dikembalikan",
  file_mkdir: "Folder dibuat",
  file_upload: "Berkas diunggah",
  file_delete: "Berkas dihapus",
  file_rename: "Berkas diganti nama",
  file_edit: "Berkas disunting",
};

function labelFor(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function ActivityLogView({ entries }: { entries: ActivityLog[] }) {
  return (
    <div className="glass rounded-xl p-5">
      <span className="eyebrow">Aktivitas terbaru</span>
      <ul className="mt-4 flex flex-col gap-2 border-l border-white/10 pl-4 font-mono text-sm">
        {entries.length === 0 && <li className="text-zinc-600">Belum ada aktivitas tercatat.</li>}
        {entries.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3">
            <span className="text-zinc-600">{new Date(e.createdAt).toLocaleTimeString()}</span>
            <span className={e.action === "login_failed" ? "text-amber-400" : "text-emerald-400"}>▸ {labelFor(e.action)}</span>
            {e.detail && <span className="truncate text-zinc-500">{e.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
