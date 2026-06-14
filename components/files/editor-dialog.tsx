"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";

export interface EditorDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; name: string }

export const EditorDialog = forwardRef<EditorDialogHandle, Props>(function EditorDialog(_p, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  return <dialog ref={r} />;
});
