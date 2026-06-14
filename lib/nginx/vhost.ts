import { eq } from "drizzle-orm";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { runOnTarget } from "@/lib/shell";
import { writeFileOnTarget } from "@/lib/system/target-fs";
import {
  renderConfig,
  renderError404Html,
  renderError502Html,
  renderPlaceholderHtml,
} from "./render";

export type VhostResult = { ok: true } | { ok: false; error: string };

import { defaultRootPath } from "./render";

const SITES_AVAILABLE = (d: string) => `/etc/nginx/sites-available/${d}.conf`;
const SITES_ENABLED = (d: string) => `/etc/nginx/sites-enabled/${d}`;
const INDEX_HTML = (root: string) => `${root}/index.html`;
const ERROR_DIR = (root: string) => `${root}/_rinpanel`;

/** Path to clean up when wipeWebroot=true. /var/www/<segments[2]>. */
function cleanupParent(rootPath: string): string {
  const segs = rootPath.split("/").filter(Boolean);
  // /var/www/<name>/...
  if (segs.length >= 3 && segs[0] === "var" && segs[1] === "www") {
    return `/var/www/${segs[2]}`;
  }
  // Fallback (should not be reachable for validated rootPaths).
  return rootPath;
}

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

export async function applyVhost(
  domain: string,
  opts: { rootPath?: string } = {},
): Promise<VhostResult> {
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  const root = opts.rootPath ?? row?.rootPath ?? defaultRootPath(domain);
  const content = row?.configOverride ?? renderConfig(domain, root);
  await writeFileOnTarget(SITES_AVAILABLE(domain), content);
  await runOnTarget(["mkdir", "-p", root]);
  await runOnTarget(["mkdir", "-p", ERROR_DIR(root)]);
  await writeFileOnTarget(INDEX_HTML(root), renderPlaceholderHtml(domain));
  await writeFileOnTarget(`${ERROR_DIR(root)}/404.html`, renderError404Html());
  await writeFileOnTarget(`${ERROR_DIR(root)}/502.html`, renderError502Html());
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
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  await runOnTarget(["rm", "-f", SITES_ENABLED(domain)]);
  await runOnTarget(["rm", "-f", SITES_AVAILABLE(domain)]);
  if (opts.wipeWebroot) {
    const root = row?.rootPath ?? defaultRootPath(domain);
    await runOnTarget(["rm", "-rf", cleanupParent(root)]);
  }
  const t = await nginxTest();
  if (!t.ok) return { ok: false, error: t.stderr };
  await nginxReload();
  return { ok: true };
}

export async function renameVhost(oldDomain: string, newDomain: string): Promise<VhostResult> {
  if (oldDomain === newDomain) return { ok: true };

  const oldRow = db.select().from(domains).where(eq(domains.domain, oldDomain)).get();
  const oldRoot = oldRow?.rootPath ?? defaultRootPath(oldDomain);
  // Sub the new domain into the rootPath wherever it referenced the old one.
  const newRoot = oldRoot.split(oldDomain).join(newDomain);
  const oldParent = cleanupParent(oldRoot);
  const newParent = cleanupParent(newRoot);
  const newContent = oldRow?.configOverride
    ? oldRow.configOverride.split(oldDomain).join(newDomain)
    : renderConfig(newDomain, newRoot);

  if (oldParent !== newParent) {
    await runOnTarget(["mv", oldParent, newParent]);
  }
  await writeFileOnTarget(SITES_AVAILABLE(newDomain), newContent);
  await runOnTarget(["ln", "-sf", SITES_AVAILABLE(newDomain), SITES_ENABLED(newDomain)]);

  const t = await nginxTest();
  if (!t.ok) {
    // Rollback
    await runOnTarget(["rm", "-f", SITES_ENABLED(newDomain)]);
    await runOnTarget(["rm", "-f", SITES_AVAILABLE(newDomain)]);
    if (oldParent !== newParent) {
      await runOnTarget(["mv", newParent, oldParent]);
    }
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
