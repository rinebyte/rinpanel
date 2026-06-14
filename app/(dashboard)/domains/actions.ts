"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { validateDomain } from "@/lib/nginx/validate";
import { applyVhost, removeVhost, renameVhost, readVhostConfig, updateVhostConfig } from "@/lib/nginx/vhost";
import { logActivity } from "@/lib/system/activity";
import { enableSsl, disableSsl } from "@/lib/nginx/ssl";

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

export interface SslActionResult {
  ok: boolean;
  error?: string;
  output?: string;
  dryRun?: boolean;
}

export async function enableDomainSsl(
  _prev: SslActionResult | undefined,
  formData: FormData,
): Promise<SslActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  const r = await enableSsl(row.domain);
  if (!r.ok) return { ok: false, error: r.error, output: r.output };

  // Skip DB flip on dry-run — dry-run isn't a real enable
  if (!r.dryRun) {
    db.update(domains)
      .set({ sslEnabled: true, updatedAt: new Date() })
      .where(eq(domains.id, id))
      .run();
    logActivity("domain_ssl_enable", row.domain);
  }
  revalidatePath("/domains");
  return { ok: true, output: r.output, dryRun: r.dryRun };
}

export async function disableDomainSsl(
  _prev: SslActionResult | undefined,
  formData: FormData,
): Promise<SslActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  const r = await disableSsl(row.domain);
  if (!r.ok) return { ok: false, error: r.error, output: r.output };

  db.update(domains)
    .set({ sslEnabled: false, updatedAt: new Date() })
    .where(eq(domains.id, id))
    .run();
  logActivity("domain_ssl_disable", row.domain);

  revalidatePath("/domains");
  return { ok: true, output: r.output };
}

export interface ConfigActionResult {
  ok: boolean;
  error?: string;
}

export async function readVhostConfigContent(domain: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  await requireSession();
  const v = validateDomain(domain);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await readVhostConfig(domain);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, content: r.content };
}

export async function updateVhostConfigAction(
  _prev: ConfigActionResult | undefined,
  formData: FormData,
): Promise<ConfigActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const content = String(formData.get("content") ?? "");

  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  // Persist the override BEFORE writing the file, so that updateVhostConfig's
  // internal callers (and applyVhost on any concurrent op) see the new content.
  const now = new Date();
  db.update(domains)
    .set({ configOverride: content, configUpdatedAt: now, updatedAt: now })
    .where(eq(domains.id, id))
    .run();

  const r = await updateVhostConfig(row.domain, content);
  if (!r.ok) {
    // Rollback DB to whatever was there before
    db.update(domains)
      .set({ configOverride: row.configOverride, configUpdatedAt: row.configUpdatedAt, updatedAt: row.updatedAt })
      .where(eq(domains.id, id))
      .run();
    return { ok: false, error: r.error };
  }

  logActivity("domain_config_edit", `${row.domain} (${content.length} bytes)`);
  revalidatePath("/domains");
  return { ok: true };
}

export async function resetVhostConfigAction(formData: FormData): Promise<ConfigActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  const now = new Date();
  db.update(domains)
    .set({ configOverride: null, configUpdatedAt: null, updatedAt: now })
    .where(eq(domains.id, id))
    .run();

  // applyVhost reads the DB row inline; with override now null it writes renderConfig output.
  const r = await applyVhost(row.domain);
  if (!r.ok) {
    // Catastrophic — leave override null since renderConfig is the safe default
    return { ok: false, error: r.error };
  }

  logActivity("domain_config_reset", row.domain);
  revalidatePath("/domains");
  return { ok: true };
}
