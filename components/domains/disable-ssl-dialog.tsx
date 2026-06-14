"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useState } from "react";
import { disableDomainSsl, type SslActionResult } from "@/app/(dashboard)/domains/actions";

export interface DisableSslDialogHandle { open: () => void; close: () => void }
interface Props { id: string; domain: string }

export const DisableSslDialog = forwardRef<DisableSslDialogHandle, Props>(function DisableSslDialog({ id, domain }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [state, formAction] = useActionState<SslActionResult | undefined, FormData>(
    async (prev, fd) => { setPhase("running"); const out = await disableDomainSsl(prev, fd); setPhase("done"); return out; },
    undefined,
  );
  useImperativeHandle(ref, () => ({
    open: () => { setPhase("idle"); r.current?.showModal(); },
    close: () => r.current?.close(),
  }));

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={formAction} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="id" value={id} />
        <div>
          <p className="eyebrow">ssl · nonaktifkan</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">Nonaktifkan SSL?</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">Nama domain · </span>
            <span className="text-zinc-200">{domain}</span>
          </p>
        </div>

        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-300">
          Sertifikat SSL akan dihapus. Domain akan kembali menggunakan koneksi standar.
        </p>

        {state?.output && (
          <>
            <p className="font-mono text-xs text-zinc-500">Detail dari layanan SSL:</p>
            <pre className="max-h-32 overflow-auto rounded-md border border-white/5 bg-black/40 p-3 font-mono text-[0.65rem] text-zinc-300">{state.output}</pre>
          </>
        )}

        {state && !state.ok && state.error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            Gagal menonaktifkan SSL. {state.error}
          </p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            {state?.ok ? "Tutup" : "Batal"}
          </button>
          {!state?.ok && (
            <button type="submit" disabled={phase === "running"}
              className="h-10 flex-1 rounded-md border border-red-500/40 bg-red-500/10 font-mono text-xs font-semibold tracking-wide uppercase text-red-300 hover:border-red-500/60 hover:bg-red-500/20 disabled:opacity-60">
              {phase === "running" ? "[ ·· ] memproses" : "Nonaktifkan SSL"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
});
