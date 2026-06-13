"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { validateDomain } from "@/lib/nginx/validate";
import { applyVhost, removeVhost, renameVhost } from "@/lib/nginx/vhost";
import { logActivity } from "@/lib/system/activity";

async function requireSession(): Promise<void> {
  const s = await auth();
  if (!s) redirect("/login");
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createDomain(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const raw = String(formData.get("domain") ?? "").trim();
  const v = validateDomain(raw);
  if (!v.ok) return { ok: false, error: v.reason };

  const existing = db.select().from(domains).where(eq(domains.domain, raw)).get();
  if (existing) return { ok: false, error: "domain already exists" };

  const r = await applyVhost(raw);
  if (!r.ok) return { ok: false, error: r.error };

  db.insert(domains).values({
    domain: raw,
    rootPath: `/var/www/${raw}/public_html`,
  }).run();
  logActivity("domain_create", raw);

  revalidatePath("/domains");
  return { ok: true };
}

export async function deleteDomain(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const wipe = formData.get("wipeWebroot") === "on";

  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  const r = await removeVhost(row.domain, { wipeWebroot: wipe });
  if (!r.ok) return { ok: false, error: r.error };

  db.delete(domains).where(eq(domains.id, id)).run();
  logActivity("domain_delete", wipe ? `${row.domain} (wiped webroot)` : row.domain);

  revalidatePath("/domains");
  return { ok: true };
}

export async function renameDomain(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("domain") ?? "").trim();

  const v = validateDomain(next);
  if (!v.ok) return { ok: false, error: v.reason };

  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };
  if (row.domain === next) return { ok: true };

  const dup = db.select().from(domains).where(eq(domains.domain, next)).get();
  if (dup) return { ok: false, error: "domain already exists" };

  const r = await renameVhost(row.domain, next);
  if (!r.ok) return { ok: false, error: r.error };

  db.update(domains)
    .set({ domain: next, rootPath: `/var/www/${next}/public_html`, updatedAt: new Date() })
    .where(eq(domains.id, id))
    .run();
  logActivity("domain_rename", `${row.domain} → ${next}`);

  revalidatePath("/domains");
  return { ok: true };
}
