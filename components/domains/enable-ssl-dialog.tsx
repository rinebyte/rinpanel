"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useState } from "react";
import { enableDomainSsl, type SslActionResult } from "@/app/(dashboard)/domains/actions";
import type { SslProvider } from "@/lib/nginx/ssl-detect";

export interface EnableSslDialogHandle { open: () => void; close: () => void }
interface Props { id: string; domain: string; email?: string; dryRun: boolean; sslProvider?: SslProvider }

export const EnableSslDialog = forwardRef<EnableSslDialogHandle, Props>(function EnableSslDialog({ id, domain, email, dryRun, sslProvider }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [state, formAction] = useActionState<SslActionResult | undefined, FormData>(
    async (prev, fd) => { setPhase("running"); const out = await enableDomainSsl(prev, fd); setPhase("done"); return out; },
    undefined,
  );
  useImperativeHandle(ref, () => ({
    open: () => { setPhase("idle"); r.current?.showModal(); },
    close: () => r.current?.close(),
  }));

  const cmd = `certbot --nginx -n --agree-tos -m ${email || "<LETS_ENCRYPT_EMAIL>"} -d ${domain}${dryRun ? " --dry-run" : ""}`;

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={formAction} className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="id" value={id} />
        <div>
          <p className="eyebrow">vhost · enable ssl</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">enable SSL?</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">domain · </span>
            <span className="text-zinc-200">{domain}</span>
          </p>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-300">
          {sslProvider === "cloudflare" ? (
            <>
              ▸ Domain ini di belakang Cloudflare. Visitor lo udah dapet HTTPS dari CF edge — install LE origin cert cuma butuh kalau di CF lo set SSL mode = "Full (Strict)".
              {dryRun && <div className="mt-1 text-amber-200/80">[dev] CERTBOT_DRY_RUN=true — gonna run --dry-run only.</div>}
            </>
          ) : (
            <>
              ▸ DNS untuk {domain} harus sudah resolve ke server ini.
              {dryRun && <div className="mt-1 text-amber-200/80">[dev] CERTBOT_DRY_RUN=true — gonna run --dry-run only.</div>}
            </>
          )}
        </div>

        <pre className="overflow-auto rounded-md border border-white/5 bg-black/40 p-3 font-mono text-[0.7rem] text-lime-200/90">{cmd}</pre>

        {state?.output && (
          <pre className="max-h-48 overflow-auto rounded-md border border-white/5 bg-black/40 p-3 font-mono text-[0.65rem] text-zinc-300">{state.output}</pre>
        )}

        {state?.ok && (
          <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
            {state.dryRun ? "dry-run successful (no cert installed)" : "SSL enabled"}
          </p>
        )}

        {state && !state.ok && state.error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            failed: {state.error}
          </p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            {state ? "Close" : "Cancel"}
          </button>
          {!state && (
            <button type="submit" disabled={phase === "running"}
              className="accent-glow h-10 flex-1 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60">
              {phase === "running" ? "[ ·· ] issuing cert" : (sslProvider === "cloudflare" ? "Install LE anyway" : "Enable SSL")}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
});
