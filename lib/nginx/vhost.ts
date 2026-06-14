import { eq } from "drizzle-orm";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { runOnTarget } from "@/lib/shell";
import { writeFileOnTarget } from "@/lib/system/target-fs";
import { renderConfig, renderPlaceholderHtml } from "./render";

export type VhostResult = { ok: true } | { ok: false; error: string };

const SITES_AVAILABLE = (d: string) => `/etc/nginx/sites-available/${d}.conf`;
const SITES_ENABLED = (d: string) => `/etc/nginx/sites-enabled/${d}`;
const WWW_ROOT = (d: string) => `/var/www/${d}`;
const WEB_ROOT = (d: string) => `/var/www/${d}/public_html`;
const INDEX_HTML = (d: string) => `${WEB_ROOT(d)}/index.html`;

async function nginxTest(): Promise<{ ok: boolean; stderr: string }> {
  const r = await runOnTarget(["nginx", "-t"]);
  return { ok: r.success, stderr: r.stderr };
}

async function nginxReload(): Promise<void> {
  await runOnTarget(["nginx", "-s", "reload"]);
  // nginx -s reload sends a signal and returns immediately; give the master
  // process ~500 ms to spawn new workers with the updated config before callers
  // probe the server (integration tests, health checks, etc.).
  await new Promise((r) => setTimeout(r, 500));
}

export async function applyVhost(domain: string): Promise<VhostResult> {
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  const content = row?.configOverride ?? renderConfig(domain);
  await writeFileOnTarget(SITES_AVAILABLE(domain), content);
  await runOnTarget(["mkdir", "-p", WEB_ROOT(domain)]);
  await writeFileOnTarget(INDEX_HTML(domain), renderPlaceholderHtml(domain));
  await runOnTarget(["ln", "-sf", SITES_AVAILABLE(domain), SITES_ENABLED(domain)]);

  const t = await nginxTest();
  if (!t.ok) {
    // Rollback: remove symlink + conf only; leave webroot in place (benign without active vhost)
    await runOnTarget(["rm", "-f", SITES_ENABLED(domain)]);
    await runOnTarget(["rm", "-f", SITES_AVAILABLE(domain)]);
    return { ok: false, error: t.stderr };
  }
  await nginxReload();
  return { ok: true };
}

export async function removeVhost(
  domain: string,
  opts: { wipeWebroot?: boolean } = {},
): Promise<VhostResult> {
  await runOnTarget(["rm", "-f", SITES_ENABLED(domain)]);
  await runOnTarget(["rm", "-f", SITES_AVAILABLE(domain)]);
  if (opts.wipeWebroot) {
    await runOnTarget(["rm", "-rf", WWW_ROOT(domain)]);
  }
  const t = await nginxTest();
  if (!t.ok) return { ok: false, error: t.stderr };
  await nginxReload();
  return { ok: true };
}

export async function renameVhost(oldDomain: string, newDomain: string): Promise<VhostResult> {
  if (oldDomain === newDomain) return { ok: true };

  const oldRow = db.select().from(domains).where(eq(domains.domain, oldDomain)).get();
  const newContent = oldRow?.configOverride
    ? oldRow.configOverride.split(oldDomain).join(newDomain)
    : renderConfig(newDomain);
  await runOnTarget(["mv", WWW_ROOT(oldDomain), WWW_ROOT(newDomain)]);
  await writeFileOnTarget(SITES_AVAILABLE(newDomain), newContent);
  await runOnTarget(["ln", "-sf", SITES_AVAILABLE(newDomain), SITES_ENABLED(newDomain)]);

  const t = await nginxTest();
  if (!t.ok) {
    // Rollback
    await runOnTarget(["rm", "-f", SITES_ENABLED(newDomain)]);
    await runOnTarget(["rm", "-f", SITES_AVAILABLE(newDomain)]);
    await runOnTarget(["mv", WWW_ROOT(newDomain), WWW_ROOT(oldDomain)]);
    return { ok: false, error: t.stderr };
  }

  await runOnTarget(["rm", "-f", SITES_ENABLED(oldDomain)]);
  await runOnTarget(["rm", "-f", SITES_AVAILABLE(oldDomain)]);
  await nginxReload();
  return { ok: true };
}

export async function readVhostConfig(domain: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const r = await runOnTarget(["cat", SITES_AVAILABLE(domain)]);
  if (!r.success) return { ok: false, error: r.stderr || "read failed" };
  return { ok: true, content: r.stdout };
}

export async function updateVhostConfig(domain: string, content: string): Promise<VhostResult> {
  if (content.length === 0) return { ok: false, error: "config cannot be empty" };
  if (content.length > 50_000) return { ok: false, error: "config too large (max 50KB)" };

  // Read current content for rollback
  const cur = await readVhostConfig(domain);
  if (!cur.ok) return { ok: false, error: `cannot read current config: ${cur.error}` };
  const previous = cur.content;

  // Write new content
  await writeFileOnTarget(SITES_AVAILABLE(domain), content);

  // Validate via nginx -t
  const t = await runOnTarget(["nginx", "-t"]);
  if (!t.success) {
    // Rollback
    await writeFileOnTarget(SITES_AVAILABLE(domain), previous);
    return { ok: false, error: t.stderr.trim() };
  }

  // Reload
  await nginxReload();
  return { ok: true };
}
