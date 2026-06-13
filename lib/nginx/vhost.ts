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
  await writeFileOnTarget(SITES_AVAILABLE(domain), renderConfig(domain));
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

  await runOnTarget(["mv", WWW_ROOT(oldDomain), WWW_ROOT(newDomain)]);
  await writeFileOnTarget(SITES_AVAILABLE(newDomain), renderConfig(newDomain));
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
