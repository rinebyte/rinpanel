"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useEffect } from "react";
import { renameEntry, type ActionResult } from "@/app/(dashboard)/files/actions";

export interface RenameDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; currentName: string }

export const RenameDialog = forwardRef<RenameDialogHandle, Props>(function RenameDialog({ domain, relPath, currentName }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(renameEntry, undefined);
  useEffect(() => { if (state?.ok) r.current?.close(); }, [state]);

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={formAction} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="domain" value={domain} />
        <input type="hidden" name="path" value={relPath} />
        <div>
          <p className="eyebrow">ganti nama</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">Ganti Nama</h2>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">nama baru</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">▸</span>
            <input
              name="newName"
              defaultValue={currentName}
              autoFocus
              required
              className="h-11 w-full rounded-md border border-white/[0.08] bg-black/40 pl-8 pr-3 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
            />
          </div>
        </label>
        {state && !state.ok && state.error && (
          <p className="font-mono text-[0.7rem] text-red-300">Gagal: {state.error}</p>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            Batal
          </button>
          <button type="submit" disabled={pending}
            className="accent-glow h-10 flex-1 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60">
            {pending ? "[ ·· ]" : "Ganti"}
          </button>
        </div>
      </form>
    </dialog>
  );
});
