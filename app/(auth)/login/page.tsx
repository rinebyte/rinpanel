"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, undefined);

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
      <form
        action={formAction}
        className="glass scan-sweep w-full max-w-sm rounded-xl p-8 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.85)]"
      >
        <div className="corner-ticks relative flex flex-col gap-6">
          <div>
            <p className="eyebrow">session · private</p>
            <h1 className="font-display mt-2 text-2xl font-bold tracking-wide text-white">rinpanel</h1>
          </div>

          <label className="flex flex-col gap-1">
            <span className="eyebrow">username</span>
            <input
              name="username"
              autoComplete="username"
              required
              className="h-11 rounded-md border border-white/10 bg-white/5 px-3 font-mono text-white placeholder:text-zinc-600 focus-visible:border-lime-500/60 focus-visible:ring-2 focus-visible:ring-lime-500/25 focus-visible:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="eyebrow">password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-11 rounded-md border border-white/10 bg-white/5 px-3 font-mono text-white placeholder:text-zinc-600 focus-visible:border-lime-500/60 focus-visible:ring-2 focus-visible:ring-lime-500/25 focus-visible:outline-none"
            />
          </label>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="accent-glow h-11 rounded-md bg-primary px-6 font-mono text-sm font-semibold tracking-wide text-primary-foreground uppercase disabled:opacity-60"
          >
            {pending ? "[ ·· ]" : "Authenticate"}
          </button>
        </div>
      </form>
    </main>
  );
}
