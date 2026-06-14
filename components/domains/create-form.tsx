"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { createDomain, type ActionResult } from "@/app/(dashboard)/domains/actions";

export function CreateForm() {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    createDomain,
    undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [domain, setDomain] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rootPath, setRootPath] = useState("");

  // Reset on success
  useEffect(() => {
    if (state?.ok) {
      inputRef.current?.form?.reset();
      setDomain("");
      setRootPath("");
      setShowAdvanced(false);
    }
  }, [state]);

  const defaultRoot = domain ? `/var/www/${domain}/public_html` : "/var/www/<domain>/public_html";

  return (
    <form action={formAction} className="glass corner-ticks relative flex flex-col gap-3 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">tambah domain</span>
        <span className="font-mono text-[0.6rem] tracking-wider text-zinc-600 uppercase">statis</span>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="eyebrow">nama domain</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">
              ▸
            </span>
            <input
              ref={inputRef}
              name="domain"
              value={domain}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(e) => setDomain(e.currentTarget.value.toLowerCase())}
              className="h-11 w-full rounded-md border border-white/[0.08] bg-black/40 pr-3 pl-8 font-mono text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-lime-500/50 focus:bg-black/60 focus:ring-2 focus:ring-lime-500/20"
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="accent-glow flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-5 font-mono text-sm font-bold tracking-wide text-primary-foreground uppercase transition disabled:opacity-60"
        >
          {pending ? (
            <>
              <span className="animate-blink">[ ·· ]</span>
              <span>menyiapkan</span>
            </>
          ) : (
            <span>+ Tambah Domain</span>
          )}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="self-start font-mono text-[0.65rem] tracking-wider text-zinc-500 uppercase hover:text-lime-400"
      >
        {showAdvanced ? "▾ lanjutan" : "▸ lanjutan (lokasi folder)"}
      </button>

      {showAdvanced && (
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">lokasi folder situs (opsional)</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">
              ▸
            </span>
            <input
              name="rootPath"
              value={rootPath}
              placeholder={defaultRoot}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setRootPath(e.currentTarget.value)}
              className="h-11 w-full rounded-md border border-white/[0.08] bg-black/40 pr-3 pl-8 font-mono text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-lime-500/50 focus:bg-black/60 focus:ring-2 focus:ring-lime-500/20"
            />
          </div>
          <p className="font-mono text-[0.65rem] text-zinc-500">
            Kosongkan untuk menggunakan lokasi standar. Harus berada di dalam <code className="text-zinc-400">/var/www/</code>.
          </p>
        </label>
      )}

      {state && !state.ok && state.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <div className="flex items-center gap-2 font-mono text-xs text-red-300">
            <span className="size-1.5 shrink-0 rounded-full bg-red-400 animate-glow-pulse" />
            Gagal: {state.error.split("\n")[0]}
          </div>
          {state.error.includes("\n") && (
            <pre className="mt-2 max-h-40 overflow-auto rounded border border-white/5 bg-black/40 p-2 font-mono text-[0.7rem] text-red-200/80">{state.error}</pre>
          )}
        </div>
      )}

      {state?.ok && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 animate-glow-pulse" />
          Domain berhasil ditambahkan.
        </div>
      )}
    </form>
  );
}
