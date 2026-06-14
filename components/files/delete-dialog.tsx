"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";

export interface DeleteDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; isDir: boolean; name: string }

export const DeleteDialog = forwardRef<DeleteDialogHandle, Props>(function DeleteDialog(_p, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  return <dialog ref={r} />;
});
