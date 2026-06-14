"use client";

import { useRef } from "react";
import Link from "next/link";
import { Folder, File as FileIcon, FileText, FileImage, FileCode, Pencil, Trash, Download, FileEdit } from "lucide-react";
import type { Entry } from "@/lib/fs/files";

// Inlined from @/lib/fs/files to avoid pulling server-only Node modules into
// this client component (the barrel imports node:child_process via runOnTarget).
const TEXT_EXT = new Set([
  "html", "htm", "css", "js", "mjs", "json", "txt", "md", "xml", "svg",
  "conf", "ini", "yaml", "yml", "csv",
]);
function isLikelyText(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
}
import { DeleteDialog, type DeleteDialogHandle } from "./delete-dialog";
import { RenameDialog, type RenameDialogHandle } from "./rename-dialog";
import { EditorDialog, type EditorDialogHandle } from "./editor-dialog";

function iconFor(entry: Entry) {
  if (entry.type === "dir") return Folder;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return FileImage;
  if (["html", "css", "js", "json", "ts", "tsx", "md", "xml"].includes(ext)) return FileCode;
  if (["txt", "log"].includes(ext)) return FileText;
  return FileIcon;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatMtime(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export function FileRow({ domain, cwd, entry }: { domain: string; cwd: string; entry: Entry }) {
  const deleteRef = useRef<DeleteDialogHandle>(null);
  const renameRef = useRef<RenameDialogHandle>(null);
  const editorRef = useRef<EditorDialogHandle>(null);

  const Icon = iconFor(entry);
  const relPath = cwd ? `${cwd}/${entry.name}` : entry.name;
  const dirHref = entry.type === "dir" ? `/files/${domain}/${relPath}` : null;
  const editable = entry.type === "file" && isLikelyText(entry.name) && entry.size <= 100 * 1024;
  const downloadHref = `/api/files/${domain}/${relPath}`;

  return (
    <li className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3 hover:bg-white/[0.02]">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-4 shrink-0 text-zinc-500" />
        {dirHref ? (
          <Link href={dirHref} className="truncate font-mono text-sm text-zinc-100 hover:text-lime-300">{entry.name}</Link>
        ) : (
          <span className="truncate font-mono text-sm text-zinc-100">{entry.name}</span>
        )}
      </div>
      <span className="font-mono text-xs text-zinc-500 text-right tabular-nums">
        {entry.type === "dir" ? "—" : formatSize(entry.size)}
      </span>
      <span className="font-mono text-xs text-zinc-500 text-right">{formatMtime(entry.mtime)}</span>

      <div className="flex items-center gap-1">
        {editable && (
          <button
            type="button"
            onClick={() => editorRef.current?.open()}
            aria-label="Edit"
            className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <FileEdit className="size-4" />
          </button>
        )}
        {entry.type === "file" && (
          <a
            href={downloadHref}
            download
            aria-label="Download"
            className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Download className="size-4" />
          </a>
        )}
        <button
          type="button"
          onClick={() => renameRef.current?.open()}
          aria-label="Rename"
          className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => deleteRef.current?.open()}
          aria-label="Delete"
          className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash className="size-4" />
        </button>
      </div>

      <DeleteDialog ref={deleteRef} domain={domain} relPath={relPath} isDir={entry.type === "dir"} name={entry.name} />
      <RenameDialog ref={renameRef} domain={domain} relPath={relPath} currentName={entry.name} />
      {editable && <EditorDialog ref={editorRef} domain={domain} relPath={relPath} name={entry.name} />}
    </li>
  );
}
