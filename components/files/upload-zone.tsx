"use client";

import { useState, useRef, useTransition } from "react";
import { Upload } from "lucide-react";
import { uploadFiles } from "@/app/(dashboard)/files/actions";

export function UploadZone({ domain, cwd }: { domain: string; cwd: string }) {
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (files: FileList | File[]) => {
    const fd = new FormData();
    fd.set("domain", domain);
    fd.set("cwd", cwd);
    for (const f of Array.from(files)) fd.append("files", f);
    setResult(null);
    startTransition(async () => {
      const r = await uploadFiles(fd);
      setResult(r);
    });
  };

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) submit(e.dataTransfer.files);
      }}
      className={`glass corner-ticks relative flex-1 rounded-xl border-2 border-dashed transition ${
        dragging ? "border-lime-500/60 bg-lime-500/[0.04]" : "border-white/10"
      } p-5`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && submit(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="flex w-full flex-col items-center justify-center gap-2 py-4 font-mono text-sm text-zinc-300"
      >
        {pending ? (
          <>
            <span className="animate-blink text-lime-300">[ ·· ]</span>
            <span className="text-zinc-400">mengunggah</span>
          </>
        ) : (
          <>
            <Upload className="size-5 text-lime-500/70" />
            <span>Letakkan berkas di sini</span>
            <span className="text-[0.7rem] text-zinc-600">atau klik untuk memilih · maksimal 50 MB per berkas</span>
          </>
        )}
      </button>

      {result && result.ok && (
        <p className="mt-2 flex items-center gap-2 font-mono text-xs text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" /> Berkas berhasil diunggah.
        </p>
      )}
      {result && !result.ok && result.error && (
        <pre className="mt-2 overflow-auto rounded border border-red-500/30 bg-red-500/10 p-2 font-mono text-[0.7rem] text-red-200/90">
          {result.error}
        </pre>
      )}
    </div>
  );
}
