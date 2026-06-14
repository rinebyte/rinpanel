"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useEffect, useState } from "react";
import { saveFile, readFileContent, type ActionResult } from "@/app/(dashboard)/files/actions";

export interface EditorDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; name: string }

export const EditorDialog = forwardRef<EditorDialogHandle, Props>(function EditorDialog({ domain, relPath, name }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(saveFile, undefined);

  useImperativeHandle(ref, () => ({
    open: async () => {
      setLoadError(null);
      r.current?.showModal();
      setLoading(true);
      const got = await readFileContent(domain, relPath);
      setLoading(false);
      if (got.ok && got.content !== undefined) setContent(got.content);
      else setLoadError(got.error ?? "failed to read file");
    },
    close: () => r.current?.close(),
  }));

  useEffect(() => { if (state?.ok) r.current?.close(); }, [state]);

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal w-[min(64rem,calc(100vw-2rem))]">
      <form action={formAction} className="flex flex-col gap-4 p-6">
        <input type="hidden" name="domain" value={domain} />
        <input type="hidden" name="path" value={relPath} />
        <div>
          <p className="eyebrow">file · edit</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white truncate">{name}</h2>
        </div>

        {loadError && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            ▸ {loadError}
          </p>
        )}

        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          disabled={loading || !!loadError}
          placeholder={loading ? "[ ·· ] loading…" : ""}
          className="h-[60vh] w-full resize-y rounded-md border border-white/[0.08] bg-black/40 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20 disabled:opacity-50"
        />

        {state && !state.ok && state.error && (
          <p className="font-mono text-xs text-red-300">▸ {state.error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 px-5 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            Cancel
          </button>
          <button type="submit" disabled={pending || loading || !!loadError}
            className="accent-glow h-10 px-5 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60">
            {pending ? "[ ·· ] saving" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
});
