"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useState } from "react";
import { enableDomainSsl, type SslActionResult } from "@/app/(dashboard)/domains/actions";
import type { SslProvider } from "@/lib/nginx/ssl-detect";

export interface EnableSslDialogHandle { open: () => void; close: () => void }
interface Props { id: string; domain: string; email?: string; dryRun: boolean; sslProvider?: SslProvider }

export const EnableSslDialog = forwardRef<EnableSslDialogHandle, Props>(function EnableSslDialog({ id, domain, email, dryRun, sslProvider }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [state, formAction] = useActionState<SslActionResult | undefined, FormData>(
    async (prev, fd) => { setPhase("running"); const out = await enableDomainSsl(prev, fd); setPhase("done"); return out; },
    undefined,
  );
  useImperativeHandle(ref, () => ({
    open: () => { setPhase("idle"); r.current?.showModal(); },
    close: () => r.current?.close(),
  }));

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={formAction} className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="id" value={id} />
        <div>
          <p className="eyebrow">ssl · aktifkan</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">Aktifkan SSL?</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">Nama domain · </span>
            <span className="text-zinc-200">{domain}</span>
          </p>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-300">
          {sslProvider === "cloudflare" ? (
            <>
              Layanan keamanan Cloudflare terdeteksi pada domain ini. Pengunjung situs Anda sudah menggunakan koneksi aman secara otomatis. Sertifikat tambahan hanya diperlukan jika Anda memilih mode &apos;Full (Strict)&apos; di Cloudflare.
            </>
          ) : (
            <>
              Pastikan nama domain ini sudah mengarah ke server Anda sebelum melanjutkan.
            </>
          )}
        </div>

        {state?.output && (
          <>
            <p className="font-mono text-xs text-zinc-500">Detail dari layanan SSL:</p>
            <pre className="max-h-48 overflow-auto rounded-md border border-white/5 bg-black/40 p-3 font-mono text-[0.65rem] text-zinc-300">{state.output}</pre>
          </>
        )}

        {state?.ok && (
          <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
            {state.dryRun ? "Pengujian berhasil. Tidak ada sertifikat yang dipasang." : "SSL berhasil diaktifkan."}
          </p>
        )}

        {state && !state.ok && state.error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            Gagal mengaktifkan SSL. {state.error}
          </p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            {state ? "Tutup" : "Batal"}
          </button>
          {!state && (
            <button type="submit" disabled={phase === "running"}
              className="accent-glow h-10 flex-1 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60">
              {phase === "running" ? "[ ·· ] memproses" : (sslProvider === "cloudflare" ? "Pasang Sertifikat" : "Aktifkan SSL")}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
});
