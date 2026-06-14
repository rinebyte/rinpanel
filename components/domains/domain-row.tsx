"use client";

import { useRef, useState, useActionState, useEffect } from "react";
import { FileCog, Pencil, Trash, Check, X, Lock, ShieldOff } from "lucide-react";
import { renameDomain, type ActionResult } from "@/app/(dashboard)/domains/actions";
import type { Domain } from "@/db/schema";
import type { SslProvider } from "@/lib/nginx/ssl-detect";
import { DeleteDialog, type DeleteDialogHandle } from "./delete-dialog";
import { EnableSslDialog, type EnableSslDialogHandle } from "./enable-ssl-dialog";
import { DisableSslDialog, type DisableSslDialogHandle } from "./disable-ssl-dialog";
import { ConfigEditorDialog, type ConfigEditorDialogHandle } from "./config-editor-dialog";

function sslChip(provider: SslProvider, sslEnabled: boolean) {
  // Priority: actual DB state (sslEnabled, set by our certbot integration) overrides detection
  if (sslEnabled) {
    return { label: "SSL · LE", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  switch (provider) {
    case "cloudflare":
      return { label: "SSL · CF", cls: "border-orange-500/30 bg-orange-500/10 text-orange-300" };
    case "letsencrypt":
      return { label: "SSL · LE", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
    case "origin":
      return { label: "SSL · OTHER", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300" };
    default:
      return null;
  }
}

interface Props {
  row: Domain;
  sslEmail: string;
  sslDryRun: boolean;
  sslProvider: SslProvider;
}

export function DomainRow({ row, sslEmail, sslDryRun, sslProvider }: Props) {
  const [editing, setEditing] = useState(false);
  const dialogRef = useRef<DeleteDialogHandle>(null);
  const enableSslRef = useRef<EnableSslDialogHandle>(null);
  const disableSslRef = useRef<DisableSslDialogHandle>(null);
  const configRef = useRef<ConfigEditorDialogHandle>(null);
  const [renameState, renameAction, renamePending] = useActionState<ActionResult | undefined, FormData>(
    renameDomain,
    undefined,
  );

  // Exit edit mode on successful rename
  useEffect(() => {
    if (renameState?.ok) setEditing(false);
  }, [renameState]);

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 hover:bg-white/[0.02]">
      <div className="flex min-w-0 flex-col gap-1">
        {editing ? (
          <form action={renameAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={row.id} />
            <div className="relative flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">
                ▸
              </span>
              <input
                name="domain"
                defaultValue={row.domain}
                autoFocus
                spellCheck={false}
                required
                onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
                className="h-9 w-full rounded-md border border-white/[0.08] bg-black/40 pr-3 pl-8 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={renamePending}
              aria-label="Save rename"
              className="grid size-9 place-items-center rounded-md border border-lime-500/40 bg-lime-500/10 text-lime-300 hover:bg-lime-500/20"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Cancel rename"
              className="grid size-9 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm text-white">{row.domain}</span>
              <span className="rounded-sm border border-lime-500/30 bg-lime-500/10 px-1.5 py-0.5 font-mono text-[0.55rem] tracking-wider text-lime-300 uppercase">
                static
              </span>
              {(() => {
                const chip = sslChip(sslProvider, row.sslEnabled);
                if (!chip) return null;
                return (
                  <span className={`rounded-sm border ${chip.cls} px-1.5 py-0.5 font-mono text-[0.55rem] tracking-wider uppercase`}>
                    {chip.label}
                  </span>
                );
              })()}
            </div>
            <span className="truncate font-mono text-[0.7rem] text-zinc-500">
              ▸ {row.rootPath}
            </span>
          </>
        )}

        {renameState && !renameState.ok && renameState.error && editing && (
          <span className="font-mono text-[0.7rem] text-red-300">▸ {renameState.error}</span>
        )}
      </div>

      {!editing && (
        <div className="flex items-center gap-1">
          {row.sslEnabled ? (
            <button
              type="button"
              onClick={() => disableSslRef.current?.open()}
              aria-label="Disable SSL"
              className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
            >
              <ShieldOff className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => enableSslRef.current?.open()}
              aria-label="Enable SSL"
              className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-lime-500/30 hover:bg-lime-500/10 hover:text-lime-300"
            >
              <Lock className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => configRef.current?.open()}
            aria-label="Edit nginx config"
            className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-sky-500/30 hover:bg-sky-500/10 hover:text-sky-300"
          >
            <FileCog className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Rename domain"
            className="grid size-9 place-items-center rounded-md border border-transparent text-zinc-500 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => dialogRef.current?.open()}
            aria-label="Delete domain"
            className="grid size-9 place-items-center rounded-md border border-transparent text-zinc-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash className="size-4" />
          </button>
        </div>
      )}

      <DeleteDialog ref={dialogRef} id={row.id} domain={row.domain} />
      <EnableSslDialog ref={enableSslRef} id={row.id} domain={row.domain} email={sslEmail} dryRun={sslDryRun} sslProvider={sslProvider} />
      <DisableSslDialog ref={disableSslRef} id={row.id} domain={row.domain} />
      <ConfigEditorDialog ref={configRef} id={row.id} domain={row.domain} />
    </li>
  );
}
