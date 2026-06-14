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
  if (!row) throw new Error("Data domain tidak ditemukan.");
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
  if (files.length === 0) return { ok: false, error: "Tidak ada berkas yang dipilih." };

  const errors: string[] = [];
  for (const file of files) {
    const relPath = cwd ? `${cwd}/${file.name}` : file.name;
    const v = validatePath(domain, relPath);
    if (!v.ok) { errors.push(`${file.name}: ${v.reason}`); continue; }
    // Pass raw bytes through as a Buffer so binary content (images, video,
    // fonts, etc.) survives the round-trip. Stringifying via toString("binary")
    // then writing back as UTF-8 inflates non-ASCII bytes into multi-byte
    // sequences and corrupts the file.
    const content = new Uint8Array(await file.arrayBuffer());
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
  if (content.length > 100 * 1024) return { ok: false, error: "Berkas terlalu besar untuk disunting (maksimal 100 KB)." };
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
  if (r.value.isBinary) return { ok: false, error: "Berkas ini tidak dapat disunting." };
  return { ok: true, content: r.value.content };
}

export async function createFile(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const cwd = String(formData.get("cwd") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const target = cwd ? `${cwd}/${name}` : name;
  const v = validatePath(domain, target);
  if (!v.ok) return { ok: false, error: v.reason };
  const w = await writeFile(domain, target, "");
  if (!w.ok) return { ok: false, error: w.error };
  logActivity("file_create", `${domain}:${target}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function deleteEntries(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const paths = formData.getAll("paths").map(String).filter(Boolean);
  if (paths.length === 0) return { ok: false, error: "Tidak ada berkas yang dipilih." };
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const errors: string[] = [];
  let okCount = 0;
  for (const p of paths) {
    const v = validatePath(domain, p);
    if (!v.ok) { errors.push(`${p}: ${v.reason}`); continue; }
    const r = await remove(domain, p, { recursive: true });
    if (!r.ok) errors.push(`${p}: ${r.error}`);
    else okCount++;
  }
  logActivity("file_bulk_delete", `${domain}: ${okCount} dihapus${errors.length ? `, ${errors.length} gagal` : ""}`);
  revalidatePath(`/files/${domain}`, "layout");
  if (errors.length) return { ok: false, error: errors.join("\n") };
  return { ok: true };
}

export async function moveEntries(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const dest = String(formData.get("dest") ?? "");
  const paths = formData.getAll("paths").map(String).filter(Boolean);
  if (paths.length === 0) return { ok: false, error: "Tidak ada berkas yang dipilih." };
  try { ensureDomainExists(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }

  // Destination must validate (empty string = root, that's fine).
  const dv = validatePath(domain, dest);
  if (!dv.ok) return { ok: false, error: `Tujuan: ${dv.reason}` };

  const errors: string[] = [];
  let okCount = 0;
  for (const p of paths) {
    const v = validatePath(domain, p);
    if (!v.ok) { errors.push(`${p}: ${v.reason}`); continue; }
    const name = p.split("/").pop() ?? "";
    if (!name) { errors.push(`${p}: nama tidak valid`); continue; }
    const newRel = dest ? `${dest}/${name}` : name;
    // No-op if same path
    if (newRel === p) continue;
    const nv = validatePath(domain, newRel);
    if (!nv.ok) { errors.push(`${p}: tujuan tidak valid (${nv.reason})`); continue; }
    const r = await rename(domain, p, newRel);
    if (!r.ok) errors.push(`${p}: ${r.error}`);
    else okCount++;
  }
  logActivity("file_bulk_move", `${domain}: ${okCount} dipindah ke "${dest || "/"}"${errors.length ? `, ${errors.length} gagal` : ""}`);
  revalidatePath(`/files/${domain}`, "layout");
  if (errors.length) return { ok: false, error: errors.join("\n") };
  return { ok: true };
}

export { listDir };
