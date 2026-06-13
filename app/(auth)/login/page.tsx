"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, undefined);

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
      <form
        action={formAction}
        className="glass scan-sweep w-full max-w-sm overflow-hidden rounded-xl shadow-[0_28px_70px_-30px_rgba(0,0,0,0.9)]"
      >
        <div className="corner-ticks relative flex flex-col gap-6 p-7">
          {/* Hero */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="eyebrow">module 00 · access</span>
              <span className="font-mono text-[0.6rem] uppercase tracking-wider text-zinc-600">
                v0.1
              </span>
            </div>
            <h1 className="font-display text-glow text-4xl leading-none font-bold tracking-wide text-white">
              rinpanel
            </h1>
            <p className="font-mono text-xs text-zinc-500">
              single-operator console · self-hosted
            </p>
          </div>

          {/* Channel divider */}
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className="flex items-center gap-1.5 font-mono text-[0.6rem] tracking-wider text-emerald-400 uppercase">
              <span className="size-1 rounded-full bg-emerald-400 animate-glow-pulse" />
              secure channel
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          {/* Fields */}
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">username</span>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/40">
                  ▸
                </span>
                <input
                  name="username"
                  autoComplete="username"
                  required
                  spellCheck={false}
                  autoFocus
                  className="h-11 w-full rounded-md border border-white/[0.08] bg-black/40 pr-3 pl-8 font-mono text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-lime-500/50 focus:bg-black/60 focus:ring-2 focus:ring-lime-500/20"
                />
              </div>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">password</span>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/40">
                  ▸
                </span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="h-11 w-full rounded-md border border-white/[0.08] bg-black/40 pr-3 pl-8 font-mono text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-lime-500/50 focus:bg-black/60 focus:ring-2 focus:ring-lime-500/20"
                />
              </div>
            </label>
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
              <span className="size-1.5 shrink-0 rounded-full bg-red-400 animate-glow-pulse" />
              {error}
            </p>
          )}

          {/* CTA */}
          <button
            type="submit"
            disabled={pending}
            className="accent-glow flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 font-mono text-sm font-bold tracking-wide text-primary-foreground uppercase transition disabled:opacity-60"
          >
            {pending ? (
              <>
                <span className="animate-blink">[ ·· ]</span>
                <span>authenticating</span>
              </>
            ) : (
              <>
                <span>authenticate</span>
                <span className="text-primary-foreground/60">↵</span>
              </>
            )}
          </button>

          {/* Footer telemetry */}
          <div className="flex items-center justify-between border-t border-white/5 pt-4">
            <span className="eyebrow text-zinc-700">session · jwt</span>
            <span className="font-mono text-[0.6rem] tracking-wider text-zinc-700 uppercase">
              rate-limited
            </span>
          </div>
        </div>
      </form>
    </main>
  );
}
