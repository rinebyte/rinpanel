"use client";

import { useRef, useState, useActionState, useEffect } from "react";
import { Pencil, Trash, Check, X } from "lucide-react";
import { renameDomain, type ActionResult } from "@/app/(dashboard)/domains/actions";
import type { Domain } from "@/db/schema";
import { DeleteDialog, type DeleteDialogHandle } from "./delete-dialog";

interface Props {
  row: Domain;
}

export function DomainRow({ row }: Props) {
  const [editing, setEditing] = useState(false);
  const dialogRef = useRef<DeleteDialogHandle>(null);
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
    </li>
  );
}
