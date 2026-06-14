"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { deleteEntry } from "@/app/(dashboard)/files/actions";

export interface DeleteDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; isDir: boolean; name: string }

export const DeleteDialog = forwardRef<DeleteDialogHandle, Props>(function DeleteDialog({ domain, relPath, isDir, name }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form
        action={(fd) => { void deleteEntry(fd); r.current?.close(); }}
        className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6"
      >
        <input type="hidden" name="domain" value={domain} />
        <input type="hidden" name="path" value={relPath} />

        <div>
          <p className="eyebrow">{isDir ? "folder · hapus" : "berkas · hapus"}</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">{isDir ? "Hapus folder?" : "Hapus berkas?"}</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">Nama · </span>
            <span className="text-zinc-200">{name}</span>
          </p>
        </div>

        {isDir && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-black/30 p-3">
            <input type="checkbox" name="recursive" required className="mt-0.5 size-4 shrink-0 accent-red-500" />
            <span className="flex flex-col gap-1">
              <span className="font-mono text-xs text-zinc-200">Hapus seluruh isi</span>
              <span className="font-mono text-[0.65rem] text-zinc-500">Seluruh isi folder akan terhapus permanen.</span>
            </span>
          </label>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            Batal
          </button>
          <button type="submit"
            className="h-10 flex-1 rounded-md border border-red-500/40 bg-red-500/10 font-mono text-xs font-semibold tracking-wide uppercase text-red-300 hover:border-red-500/60 hover:bg-red-500/20">
            Hapus
          </button>
        </div>
      </form>
    </dialog>
  );
});
