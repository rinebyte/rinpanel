"use client";

import { useActionState, useRef, useEffect } from "react";
import { FolderPlus } from "lucide-react";
import { mkdirEntry, type ActionResult } from "@/app/(dashboard)/files/actions";

export function MkdirForm({ domain, cwd }: { domain: string; cwd: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(mkdirEntry, undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state?.ok) inputRef.current?.form?.reset(); }, [state]);

  return (
    <form action={formAction} className="glass corner-ticks relative flex flex-col gap-2 rounded-xl p-5 md:max-w-xs">
      <input type="hidden" name="domain" value={domain} />
      <input type="hidden" name="cwd" value={cwd} />
      <span className="eyebrow">folder baru</span>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">▸</span>
          <input
            ref={inputRef}
            name="name"
            required
            placeholder="nama-folder"
            className="h-10 w-full rounded-md border border-white/[0.08] bg-black/40 pl-8 pr-3 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-label="Create folder"
          className="accent-glow grid size-10 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-60"
        >
          <FolderPlus className="size-4" />
        </button>
      </div>
      {state && !state.ok && state.error && (
        <p className="font-mono text-[0.7rem] text-red-300">Gagal: {state.error}</p>
      )}
    </form>
  );
}
