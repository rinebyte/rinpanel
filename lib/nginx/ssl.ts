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
