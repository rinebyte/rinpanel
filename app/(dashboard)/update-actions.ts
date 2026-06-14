"use server";

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logActivity } from "@/lib/system/activity";

async function requireSession() {
  const s = await auth();
  if (!s) redirect("/login");
}

function installDir(): string {
  return process.env.INSTALL_DIR ?? "/opt/rinpanel";
}

function gitOutput(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn("git", ["-C", installDir(), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (c) => { stdout += c.toString(); });
    p.stderr.on("data", (c) => { stderr += c.toString(); });
    p.on("error", () => resolve({ ok: false, stdout: "", stderr: "git binary not found" }));
    p.on("close", (code) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

export interface UpdateInfo {
  ok: boolean;
  currentSha?: string;
  currentDate?: string;
  latestSha?: string;
  latestDate?: string;
  upToDate?: boolean;
  behind?: number;
  commits?: string[];
  error?: string;
  /** Last update status from the script, if any: pulling/installing/building/restarting/ok/failed. */
  lastStatus?: string;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  await requireSession();

  // git fetch — pull latest refs from origin/main without merging.
  const fetched = await gitOutput(["fetch", "--quiet", "origin", "main"]);
  if (!fetched.ok) return { ok: false, error: fetched.stderr || "Gagal mengambil pembaruan." };

  const cur = await gitOutput(["rev-parse", "HEAD"]);
  const lat = await gitOutput(["rev-parse", "origin/main"]);
  if (!cur.ok || !lat.ok) {
    return { ok: false, error: "Tidak dapat membaca status repositori." };
  }

  const upToDate = cur.stdout === lat.stdout;
  let commits: string[] = [];
  let behind = 0;
  if (!upToDate) {
    const log = await gitOutput(["log", "--oneline", "--no-decorate", "HEAD..origin/main"]);
    commits = log.stdout.split("\n").filter(Boolean).slice(0, 20);
    behind = commits.length;
  }

  const curDate = (await gitOutput(["log", "-1", "--format=%cI", "HEAD"])).stdout;
  const latDate = (await gitOutput(["log", "-1", "--format=%cI", "origin/main"])).stdout;

  // Best-effort read of last script run status.
  let lastStatus: string | undefined;
  try {
    const raw = await readFile(`${installDir()}/.update-status`, "utf8");
    lastStatus = raw.trim() || undefined;
  } catch { /* file missing; ignore */ }

  return {
    ok: true,
    currentSha: cur.stdout.slice(0, 7),
    currentDate: curDate,
    latestSha: lat.stdout.slice(0, 7),
    latestDate: latDate,
    upToDate,
    behind,
    commits,
    lastStatus,
  };
}

export interface UpdateStartResult { ok: boolean; error?: string }

export async function startUpdate(): Promise<UpdateStartResult> {
  await requireSession();

  const dir = installDir();
  const script = `${dir}/scripts/self-update.sh`;

  // Detach via systemd-run so the script lives in its own transient unit and
  // survives the `systemctl restart rinpanel` at the very end.
  const p = spawn(
    "systemd-run",
    [
      "--collect",
      "--no-block",
      "--unit=rinpanel-update",
      `--setenv=INSTALL_DIR=${dir}`,
      "bash",
      script,
    ],
    { detached: true, stdio: "ignore" },
  );

  return await new Promise<UpdateStartResult>((resolve) => {
    p.on("error", (err) => {
      resolve({ ok: false, error: err.message || "systemd-run tidak tersedia." });
    });
    // Give the child a moment to fork; if it errors immediately we still hit
    // the handler above. Otherwise treat as kicked off successfully.
    setTimeout(() => {
      p.unref();
      logActivity("panel_update_start", "self-update kicked off");
      resolve({ ok: true });
    }, 250);
  });
}
