import { runOnTarget } from "@/lib/shell";
import { writeFileOnTarget } from "@/lib/system/target-fs";
import { validatePath } from "./path";

export type Entry = { name: string; type: "file" | "dir" | "other"; size: number; mtime: number };

export type FsResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

function rejectOnInvalidPath(domain: string, rel: string): string {
  const v = validatePath(domain, rel);
  if (!v.ok) throw new Error(`invalid path: ${v.reason}`);
  return v.absolute;
}

const TEXT_EXT = new Set([
  "html", "htm", "css", "js", "mjs", "json", "txt", "md", "xml", "svg",
  "conf", "ini", "yaml", "yml", "csv",
]);

export function isLikelyText(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
}

export async function listDir(domain: string, relPath: string): Promise<FsResult<{ entries: Entry[] }>> {
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const r = await runOnTarget(["find", abs, "-maxdepth", "1", "-printf", "%y\t%s\t%T@\t%f\n"]);
  if (!r.success) return { ok: false, error: r.stderr || "listDir failed" };
  const basename = abs.split("/").filter(Boolean).pop() ?? "";
  const entries: Entry[] = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [t, size, mtime, ...nameParts] = line.split("\t");
      return {
        type: t === "f" ? "file" : t === "d" ? "dir" : "other",
        size: parseInt(size, 10) || 0,
        mtime: Math.floor(parseFloat(mtime) || 0),
        name: nameParts.join("\t"),
      };
    })
    .filter((e) => e.name && e.name !== basename);
  return { ok: true, value: { entries } };
}

export async function readFile(
  domain: string,
  relPath: string,
  maxBytes = 100 * 1024,
): Promise<FsResult<{ content: string; truncated: boolean; isBinary: boolean }>> {
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const r = await runOnTarget(["head", "-c", String(maxBytes + 1), abs]);
  if (!r.success) return { ok: false, error: r.stderr || "readFile failed" };
  const truncated = r.stdout.length > maxBytes;
  const content = truncated ? r.stdout.slice(0, maxBytes) : r.stdout;
  const isBinary = /\x00/.test(content.slice(0, 8192));
  return { ok: true, value: { content, truncated, isBinary } };
}

export async function writeFile(domain: string, relPath: string, content: string): Promise<FsResult> {
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  await writeFileOnTarget(abs, content);
  const own = await runOnTarget(["chown", "root:www-data", abs]);
  const mode = await runOnTarget(["chmod", "644", abs]);
  if (!own.success || !mode.success) {
    return { ok: false, error: (own.stderr || mode.stderr || "chmod/chown failed").trim() };
  }
  return { ok: true };
}

export async function mkdir(domain: string, relPath: string): Promise<FsResult> {
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const r = await runOnTarget(["mkdir", "-p", abs]);
  if (!r.success) return { ok: false, error: r.stderr || "mkdir failed" };
  await runOnTarget(["chown", "root:www-data", abs]);
  await runOnTarget(["chmod", "755", abs]);
  return { ok: true };
}

export async function remove(
  domain: string,
  relPath: string,
  opts: { recursive?: boolean } = {},
): Promise<FsResult> {
  if (relPath === "" || relPath === "/") {
    return { ok: false, error: "refusing to delete webroot itself — use removeVhost instead" };
  }
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const argv = opts.recursive ? ["rm", "-rf", abs] : ["rm", "-f", abs];
  const r = await runOnTarget(argv);
  if (!r.success) return { ok: false, error: r.stderr || "remove failed" };
  return { ok: true };
}

export async function rename(domain: string, oldRel: string, newRel: string): Promise<FsResult> {
  let oldAbs: string, newAbs: string;
  try {
    oldAbs = rejectOnInvalidPath(domain, oldRel);
    newAbs = rejectOnInvalidPath(domain, newRel);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const r = await runOnTarget(["mv", oldAbs, newAbs]);
  if (!r.success) return { ok: false, error: r.stderr || "rename failed" };
  return { ok: true };
}
