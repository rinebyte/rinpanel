"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";

export interface RenameDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; currentName: string }

export const RenameDialog = forwardRef<RenameDialogHandle, Props>(function RenameDialog(_p, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  return <dialog ref={r} />;
});
