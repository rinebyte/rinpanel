"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Folder, File as FileIcon, FileText, FileImage, FileCode, FileVideo, FileAudio,
  Pencil, Trash, Download, FileEdit,
} from "lucide-react";
import type { Entry } from "@/lib/fs/files";

const TEXT_EXT = new Set([
  "html", "htm", "css", "js", "mjs", "json", "txt", "md", "xml", "svg",
  "conf", "ini", "yaml", "yml", "csv",
]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv", "ogv", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "oga", "m4a", "flac", "opus"]);

function ext(name: string): string { return name.split(".").pop()?.toLowerCase() ?? ""; }
function isLikelyText(name: string): boolean { return TEXT_EXT.has(ext(name)); }
function mediaKind(name: string): "image" | "video" | "audio" | null {
  const e = ext(name);
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  return null;
}

import { DeleteDialog, type DeleteDialogHandle } from "./delete-dialog";
import { RenameDialog, type RenameDialogHandle } from "./rename-dialog";
import { EditorDialog, type EditorDialogHandle } from "./editor-dialog";
import { MediaPreviewDialog, type MediaPreviewDialogHandle } from "./media-preview-dialog";

function iconFor(entry: Entry) {
  if (entry.type === "dir") return Folder;
  const e = ext(entry.name);
  if (IMAGE_EXT.has(e)) return FileImage;
  if (VIDEO_EXT.has(e)) return FileVideo;
  if (AUDIO_EXT.has(e)) return FileAudio;
  if (["html", "css", "js", "json", "ts", "tsx", "md", "xml"].includes(e)) return FileCode;
  if (["txt", "log"].includes(e)) return FileText;
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

interface FileRowProps {
  domain: string;
  cwd: string;
  entry: Entry;
  selected: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  /** Set only when entry.type === "dir" — this row is a drop target. */
  onDropDir?: (e: React.DragEvent) => void;
}

export function FileRow({ domain, cwd, entry, selected, onToggle, onDragStart, onDropDir }: FileRowProps) {
  const deleteRef = useRef<DeleteDialogHandle>(null);
  const renameRef = useRef<RenameDialogHandle>(null);
  const editorRef = useRef<EditorDialogHandle>(null);
  const previewRef = useRef<MediaPreviewDialogHandle>(null);
  const [hoverDrop, setHoverDrop] = useState(false);

  const Icon = iconFor(entry);
  const relPath = cwd ? `${cwd}/${entry.name}` : entry.name;
  const dirHref = entry.type === "dir" ? `/files/${domain}/${relPath}` : null;
  const editable = entry.type === "file" && isLikelyText(entry.name) && entry.size <= 100 * 1024;
  const previewHref = `/api/files/${domain}/${encodeURI(relPath)}`;
  const downloadHref = `${previewHref}?dl=1`;
  const media = entry.type === "file" ? mediaKind(entry.name) : null;
  const isImage = media === "image";
  const openPreview = () => previewRef.current?.open();

  const dropProps = onDropDir
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes("application/x-rinpanel-paths")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setHoverDrop(true);
          }
        },
        onDragLeave: () => setHoverDrop(false),
        onDrop: (e: React.DragEvent) => {
          setHoverDrop(false);
          onDropDir(e);
        },
      }
    : {};

  return (
    <li
      draggable
      onDragStart={onDragStart}
      {...dropProps}
      className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 px-5 py-3 transition ${
        hoverDrop ? "bg-lime-500/10 ring-1 ring-inset ring-lime-500/40" : "hover:bg-white/[0.02]"
      } ${selected ? "bg-lime-500/[0.04]" : ""}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Pilih ${entry.name}`}
        className="size-4 accent-lime-500"
        onClick={(e) => e.stopPropagation()}
      />

      <div className="flex min-w-0 items-center gap-3">
        {isImage ? (
          <button
            type="button"
            onClick={openPreview}
            aria-label="Pratinjau"
            className="block size-8 shrink-0 overflow-hidden rounded border border-white/[0.06] bg-black/40"
          >
            <img
              src={previewHref}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </button>
        ) : (
          <Icon className="size-4 shrink-0 text-zinc-500" />
        )}
        {dirHref ? (
          <Link href={dirHref} className="truncate font-mono text-sm text-zinc-100 hover:text-lime-300">{entry.name}</Link>
        ) : media ? (
          <button
            type="button"
            onClick={openPreview}
            className="truncate text-left font-mono text-sm text-zinc-100 hover:text-lime-300"
          >
            {entry.name}
          </button>
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
            aria-label="Sunting"
            className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <FileEdit className="size-4" />
          </button>
        )}
        {entry.type === "file" && (
          <a
            href={downloadHref}
            download
            aria-label="Unduh"
            className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Download className="size-4" />
          </a>
        )}
        <button
          type="button"
          onClick={() => renameRef.current?.open()}
          aria-label="Ganti nama"
          className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => deleteRef.current?.open()}
          aria-label="Hapus"
          className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash className="size-4" />
        </button>
      </div>

      <DeleteDialog ref={deleteRef} domain={domain} relPath={relPath} isDir={entry.type === "dir"} name={entry.name} />
      <RenameDialog ref={renameRef} domain={domain} relPath={relPath} currentName={entry.name} />
      {editable && <EditorDialog ref={editorRef} domain={domain} relPath={relPath} name={entry.name} />}
      {media && (
        <MediaPreviewDialog ref={previewRef} src={previewHref} kind={media} name={entry.name} />
      )}
    </li>
  );
}
