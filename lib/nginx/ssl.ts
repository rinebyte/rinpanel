import { runOnTarget } from "@/lib/shell";
import { applyVhost } from "./vhost";

export function buildEnableArgv(domain: string, email: string, dryRun: boolean): string[] {
  const argv = [
    "certbot", "--nginx",
    "--non-interactive", "--agree-tos",
    "-m", email,
    "-d", domain,
    "--redirect",
  ];
  if (dryRun) argv.push("--dry-run");
  return argv;
}

export type SslResult =
  | { ok: true; output: string; dryRun?: boolean }
  | { ok: false; error: string; output: string };

function useDryRun(): boolean {
  return process.env.CERTBOT_DRY_RUN !== "false"; // default true (safe)
}

function adminEmail(): string | null {
  return process.env.LETS_ENCRYPT_EMAIL?.trim() || null;
}

export async function enableSsl(domain: string): Promise<SslResult> {
  const email = adminEmail();
  if (!email) return { ok: false, error: "LETS_ENCRYPT_EMAIL must be set in .env.local", output: "" };

  const confCheck = await runOnTarget(["test", "-f", `/etc/nginx/sites-available/${domain}.conf`]);
  if (!confCheck.success) {
    return { ok: false, error: `vhost not provisioned for ${domain}`, output: "" };
  }

  const dryRun = useDryRun();
  const r = await runOnTarget(buildEnableArgv(domain, email, dryRun));
  const output = `${r.stdout}\n${r.stderr}`.trim();

  if (!r.success) {
    return { ok: false, error: (r.stderr || "certbot failed").split("\n").slice(-3).join("\n"), output };
  }

  if (dryRun) return { ok: true, output, dryRun: true };

  const t = await runOnTarget(["nginx", "-t"]);
  if (!t.success) {
    return { ok: false, error: `nginx -t failed after certbot: ${t.stderr}`, output };
  }
  await runOnTarget(["nginx", "-s", "reload"]);
  return { ok: true, output };
}

export async function disableSsl(domain: string): Promise<SslResult> {
  const r = await runOnTarget(["certbot", "delete", "--cert-name", domain, "--non-interactive"]);
  const output = `${r.stdout}\n${r.stderr}`.trim();

  // certbot delete may error if no cert exists; soft-treat as success and continue —
  // the goal of disableSsl is "domain off SSL" either way.

  const re = await applyVhost(domain);
  if (!re.ok) return { ok: false, error: `re-apply vhost failed: ${re.error}`, output };

  return { ok: true, output };
}
