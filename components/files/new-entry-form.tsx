"use client";

import { useState, useActionState, useRef, useEffect } from "react";
import { FolderPlus, FilePlus } from "lucide-react";
import {
  mkdirEntry,
  createFile,
  type ActionResult,
} from "@/app/(dashboard)/files/actions";

type Mode = "folder" | "file";

export function NewEntryForm({ domain, cwd }: { domain: string; cwd: string }) {
  const [mode, setMode] = useState<Mode>("folder");
  const [folderState, folderAction, folderPending] = useActionState<ActionResult | undefined, FormData>(
    mkdirEntry,
    undefined,
  );
  const [fileState, fileAction, filePending] = useActionState<ActionResult | undefined, FormData>(
    createFile,
    undefined,
  );
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const state = mode === "folder" ? folderState : fileState;
  const pending = mode === "folder" ? folderPending : filePending;

  useEffect(() => {
    if (state?.ok) {
      if (mode === "folder") folderRef.current?.form?.reset();
      else fileRef.current?.form?.reset();
    }
  }, [state, mode]);

  return (
    <div className="glass corner-ticks relative flex flex-col gap-3 rounded-xl p-5 md:max-w-xs">
      <div className="flex items-center justify-between">
        <span className="eyebrow">baru</span>
        <div className="flex gap-1 rounded-md border border-white/[0.06] bg-black/30 p-0.5">
          <button
            type="button"
            onClick={() => setMode("folder")}
            className={`grid h-7 w-7 place-items-center rounded ${
              mode === "folder" ? "bg-lime-500/15 text-lime-300" : "text-zinc-500 hover:text-zinc-200"
            }`}
            aria-label="Folder baru"
            title="Folder baru"
          >
            <FolderPlus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`grid h-7 w-7 place-items-center rounded ${
              mode === "file" ? "bg-lime-500/15 text-lime-300" : "text-zinc-500 hover:text-zinc-200"
            }`}
            aria-label="Berkas baru"
            title="Berkas baru"
          >
            <FilePlus className="size-3.5" />
          </button>
        </div>
      </div>

      {mode === "folder" ? (
        <form action={folderAction} className="flex flex-col gap-2">
          <input type="hidden" name="domain" value={domain} />
          <input type="hidden" name="cwd" value={cwd} />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">▸</span>
              <input
                ref={folderRef}
                name="name"
                required
                placeholder="nama-folder"
                className="h-10 w-full rounded-md border border-white/[0.08] bg-black/40 pl-8 pr-3 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              aria-label="Buat folder"
              className="accent-glow grid size-10 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-60"
            >
              <FolderPlus className="size-4" />
            </button>
          </div>
        </form>
      ) : (
        <form action={fileAction} className="flex flex-col gap-2">
          <input type="hidden" name="domain" value={domain} />
          <input type="hidden" name="cwd" value={cwd} />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">▸</span>
              <input
                ref={fileRef}
                name="name"
                required
                placeholder="nama.html"
                className="h-10 w-full rounded-md border border-white/[0.08] bg-black/40 pl-8 pr-3 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              aria-label="Buat berkas"
              className="accent-glow grid size-10 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-60"
            >
              <FilePlus className="size-4" />
            </button>
          </div>
        </form>
      )}

      {state && !state.ok && state.error && (
        <p className="font-mono text-[0.7rem] text-red-300">Gagal: {state.error}</p>
      )}
    </div>
  );
}
