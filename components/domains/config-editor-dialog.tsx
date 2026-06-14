"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useEffect, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import {
  readVhostConfigContent,
  updateVhostConfigAction,
  resetVhostConfigAction,
  type ConfigActionResult,
} from "@/app/(dashboard)/domains/actions";

export interface ConfigEditorDialogHandle { open: () => void; close: () => void }
interface Props { id: string; domain: string }

export const ConfigEditorDialog = forwardRef<ConfigEditorDialogHandle, Props>(function ConfigEditorDialog({ id, domain }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetPending, startReset] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);
  const [state, formAction, savePending] = useActionState<ConfigActionResult | undefined, FormData>(updateVhostConfigAction, undefined);

  const load = async () => {
    setLoadError(null);
    setLoaded(false);
    const got = await readVhostConfigContent(domain);
    if (got.ok && got.content !== undefined) setContent(got.content);
    else setLoadError(got.error ?? "failed to read config");
    setLoaded(true);
  };

  useImperativeHandle(ref, () => ({
    open: async () => {
      r.current?.showModal();
      await load();
    },
    close: () => r.current?.close(),
  }));

  // Reload content after a successful save so the editor reflects the on-disk state
  useEffect(() => {
    if (state?.ok) {
      // Show success briefly; user can keep editing
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleReset = () => {
    if (!confirm("Reset config ke template default? Custom edits akan hilang.")) return;
    const fd = new FormData();
    fd.set("id", id);
    setResetError(null);
    startReset(async () => {
      const out = await resetVhostConfigAction(fd);
      if (!out.ok) setResetError(out.error ?? "reset failed");
      else await load();
    });
  };

  return (
    <dialog
      ref={r}
      className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal w-[min(72rem,calc(100vw-2rem))]"
    >
      <form action={formAction} className="flex flex-col gap-4 p-6">
        <input type="hidden" name="id" value={id} />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">vhost · edit config</p>
            <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white truncate">{domain}</h2>
          </div>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetPending || savePending || !loaded}
            className="flex h-9 items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 font-mono text-[0.7rem] tracking-wide uppercase text-red-300 hover:border-red-500/60 hover:bg-red-500/20 disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            {resetPending ? "[ ·· ] resetting" : "Reset to default"}
          </button>
        </div>

        <p className="font-mono text-[0.7rem] text-zinc-500">
          ▸ rinpanel akan run <code className="text-zinc-300">nginx -t</code> sebelum apply. Invalid syntax = ditolak, nginx tetep jalan dengan config lama.
        </p>

        {loadError && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">▸ {loadError}</p>
        )}

        {resetError && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">▸ reset failed: {resetError}</p>
        )}

        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          disabled={!loaded || !!loadError || resetPending}
          placeholder={!loaded ? "[ ·· ] loading…" : ""}
          className="h-[60vh] w-full resize-y rounded-md border border-white/[0.08] bg-black/40 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20 disabled:opacity-50"
        />

        {state?.ok && (
          <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
            config validated + applied
          </p>
        )}

        {state && !state.ok && state.error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
            <p className="flex items-center gap-2 font-mono text-xs text-red-300">
              <span className="size-1.5 shrink-0 rounded-full bg-red-400 animate-glow-pulse" />
              nginx -t failed (rolled back):
            </p>
            <pre className="mt-2 max-h-40 overflow-auto rounded border border-white/5 bg-black/40 p-2 font-mono text-[0.7rem] text-red-200/90">{state.error}</pre>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => r.current?.close()}
            className="h-10 px-5 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={savePending || resetPending || !loaded || !!loadError}
            className="accent-glow h-10 px-5 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60"
          >
            {savePending ? "[ ·· ] validating" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
});
