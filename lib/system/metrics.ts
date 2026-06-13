import { runOnTarget } from "@/lib/shell";

function statTotals(cpuLine: string): { total: number; idle: number } {
  const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0); // idle + iowait
  const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return { total, idle };
}

export function parseCpuUsage(raw: string): { usagePct: number } {
  const aggregates = raw.split("\n").filter((l) => /^cpu\s/.test(l));
  if (aggregates.length < 2) throw new Error("expected two /proc/stat samples");
  const a = statTotals(aggregates[0]);
  const b = statTotals(aggregates[1]);
  const totalDelta = b.total - a.total;
  const idleDelta = b.idle - a.idle;
  const usage = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
  return { usagePct: Math.round(usage * 10) / 10 };
}

export function parseMemory(raw: string) {
  const line = raw.split("\n").find((l) => l.startsWith("Mem:"));
  if (!line) throw new Error("no Mem: line in free output");
  const cols = line.trim().split(/\s+/); // ["Mem:", total, used, free, shared, buff/cache, available]
  const totalMb = Number(cols[1]);
  const usedMb = Number(cols[2]);
  const availMb = Number(cols[6]);
  const usagePct = totalMb > 0 ? Math.round(((totalMb - availMb) / totalMb) * 1000) / 10 : 0;
  return { totalMb, usedMb, availMb, usagePct };
}

export function parseDisk(raw: string) {
  const lines = raw.trim().split("\n");
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  return {
    mount: cols[5],
    sizeKb: parseInt(cols[1], 10),
    usedKb: parseInt(cols[2], 10),
    availKb: parseInt(cols[3], 10),
    usagePct: parseInt(cols[4], 10),
  };
}

export function parseLoadAvg(raw: string) {
  const [one, five, fifteen] = raw.trim().split(/\s+/).map(Number);
  return { one, five, fifteen };
}

export function parseUptime(raw: string): number {
  return Math.floor(Number(raw.trim().split(/\s+/)[0]));
}

export interface SystemMetrics {
  cpu: { usagePct: number } | null;
  memory: { totalMb: number; usedMb: number; availMb: number; usagePct: number } | null;
  disk: { mount: string; sizeKb: number; usedKb: number; availKb: number; usagePct: number } | null;
  load: { one: number; five: number; fifteen: number } | null;
  uptimeSec: number | null;
  hostname: string | null;
  errors: string[];
  ts: number;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function getMetrics(): Promise<SystemMetrics> {
  const errors: string[] = [];
  const [cpuR, memR, diskR, loadR, upR, hostR] = await Promise.all([
    runOnTarget(["bash", "-c", "cat /proc/stat; sleep 0.25; cat /proc/stat"]),
    runOnTarget(["free", "-m"]),
    runOnTarget(["df", "-P", "-BK", "/"]),
    runOnTarget(["cat", "/proc/loadavg"]),
    runOnTarget(["cat", "/proc/uptime"]),
    runOnTarget(["hostname"]),
  ]);

  const safe = <T>(r: { success: boolean; stdout: string; stderr: string }, label: string, fn: (s: string) => T): T | null => {
    try {
      if (!r.success) throw new Error(r.stderr || "read failed");
      return fn(r.stdout);
    } catch (e) {
      errors.push(`${label}: ${msg(e)}`);
      return null;
    }
  };

  return {
    cpu: safe(cpuR, "cpu", parseCpuUsage),
    memory: safe(memR, "memory", parseMemory),
    disk: safe(diskR, "disk", parseDisk),
    load: safe(loadR, "load", parseLoadAvg),
    uptimeSec: safe(upR, "uptime", parseUptime),
    hostname: safe(hostR, "hostname", (s) => s.trim()),
    errors,
    ts: Date.now(),
  };
}
