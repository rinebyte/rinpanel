"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { listDir, mkdir, readFile, remove, rename, writeFile } from "@/lib/fs/files";
import { validatePath } from "@/lib/fs/path";
import { logActivity } from "@/lib/system/activity";

async function requireSession() {
  const s = await auth();
  if (!s) redirect("/login");
}

function ensureDomainExists(domain: string) {
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  if (!row) throw new Error("domain not found");
  return row;
}

export interface ActionResult { ok: boolean; error?: string }

export async function mkdirEntry(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const cwd = String(formData.get("cwd") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const target = cwd ? `${cwd}/${name}` : name;
  const v = validatePath(domain, target);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await mkdir(domain, target);
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_mkdir", `${domain}:${target}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function uploadFiles(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const cwd = String(formData.get("cwd") ?? "");
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, error: "no files supplied" };

  const errors: string[] = [];
  for (const file of files) {
    const relPath = cwd ? `${cwd}/${file.name}` : file.name;
    const v = validatePath(domain, relPath);
    if (!v.ok) { errors.push(`${file.name}: ${v.reason}`); continue; }
    // Bytes-as-Latin1 string preserves the raw byte sequence end-to-end.
    const content = Buffer.from(await file.arrayBuffer()).toString("binary");
    const w = await writeFile(domain, relPath, content);
    if (!w.ok) errors.push(`${file.name}: ${w.error}`);
  }
  logActivity("file_upload", `${domain}:${cwd || "/"} (${files.length} files)`);
  revalidatePath(`/files/${domain}`, "layout");
  if (errors.length) return { ok: false, error: errors.join("\n") };
  return { ok: true };
}

export async function deleteEntry(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const relPath = String(formData.get("path") ?? "");
  const recursive = formData.get("recursive") === "on";
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const v = validatePath(domain, relPath);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await remove(domain, relPath, { recursive });
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_delete", `${domain}:${relPath}${recursive ? " (recursive)" : ""}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function renameEntry(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const oldRel = String(formData.get("path") ?? "");
  const newName = String(formData.get("newName") ?? "").trim();
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const parent = oldRel.split("/").slice(0, -1).join("/");
  const newRel = parent ? `${parent}/${newName}` : newName;
  const v = validatePath(domain, newRel);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await rename(domain, oldRel, newRel);
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_rename", `${domain}:${oldRel} → ${newRel}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function saveFile(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const relPath = String(formData.get("path") ?? "");
  const content = String(formData.get("content") ?? "");
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const v = validatePath(domain, relPath);
  if (!v.ok) return { ok: false, error: v.reason };
  if (content.length > 100 * 1024) return { ok: false, error: "file too large (max 100 KB inline)" };
  const r = await writeFile(domain, relPath, content);
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_edit", `${domain}:${relPath}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function readFileContent(domain: string, relPath: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  await requireSession();
  const v = validatePath(domain, relPath);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await readFile(domain, relPath);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.value.isBinary) return { ok: false, error: "binary file — not editable" };
  return { ok: true, content: r.value.content };
}

export { listDir };
