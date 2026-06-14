"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

export interface MediaPreviewDialogHandle { open: () => void; close: () => void }
type MediaKind = "image" | "video" | "audio";
interface Props { src: string; kind: MediaKind; name: string }

export const MediaPreviewDialog = forwardRef<MediaPreviewDialogHandle, Props>(function MediaPreviewDialog({ src, kind, name }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({
    open: () => r.current?.showModal(),
    close: () => r.current?.close(),
  }));

  return (
    <dialog
      ref={r}
      onClick={(e) => { if (e.target === r.current) r.current?.close(); }}
      className="glass corner-ticks relative m-auto rounded-xl p-0 text-zinc-200 backdrop:bg-black/70 backdrop:backdrop-blur-md open:animate-reveal w-[min(56rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)]"
    >
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">pratinjau</p>
            <p className="truncate font-mono text-sm text-zinc-200">{name}</p>
          </div>
          <button
            type="button"
            onClick={() => r.current?.close()}
            className="h-9 shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-3 font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white"
          >
            Tutup
          </button>
        </div>

        <div className="flex items-center justify-center rounded-md border border-white/[0.06] bg-black/40 p-2 overflow-hidden">
          {kind === "image" && (
            <img
              src={src}
              alt={name}
              className="max-h-[70vh] max-w-full object-contain rounded"
            />
          )}
          {kind === "video" && (
            <video
              src={src}
              controls
              preload="metadata"
              className="max-h-[70vh] max-w-full rounded"
            />
          )}
          {kind === "audio" && (
            <audio src={src} controls preload="metadata" className="w-full" />
          )}
        </div>
      </div>
    </dialog>
  );
});
