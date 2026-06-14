import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { auth } from "@/auth";

// archiver is a CommonJS package; Turbopack's ESM interop can't find its
// default export at static analysis time. Resolve it at runtime instead.
interface ArchiverStream extends NodeJS.ReadableStream {
  directory(src: string, dest: string | false): this;
  file(src: string, data: { name: string }): this;
  finalize(): Promise<void>;
}
const archiver = createRequire(import.meta.url)("archiver") as (
  format: "zip",
  opts?: { zlib?: { level?: number } },
) => ArchiverStream;
import { db } from "@/db";
import { domains } from "@/db/schema";
import { validatePath } from "@/lib/fs/path";

// Streams a ZIP archive of the requested files. Body shape:
//   { paths: string[] }   paths are validatePath-relative within the domain.
// Each `paths` entry can be a file or a directory; directories are zipped
// recursively. Up to 200 entries per request.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ domain: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const { domain } = await ctx.params;
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  if (!row) return new Response("domain not found", { status: 404 });

  let body: { paths?: unknown };
  try { body = await req.json(); } catch { return new Response("invalid JSON body", { status: 400 }); }
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
  if (paths.length === 0) return new Response("no paths supplied", { status: 400 });
  if (paths.length > 200) return new Response("too many paths (max 200)", { status: 400 });

  // Validate every path; collect absolute targets.
  const targets: Array<{ rel: string; abs: string }> = [];
  for (const p of paths) {
    const v = validatePath(domain, p);
    if (!v.ok) return new Response(`Path invalid (${p}): ${v.reason}`, { status: 400 });
    targets.push({ rel: p, abs: v.absolute });
  }

  const filename = paths.length === 1 ? `${basename(paths[0])}.zip` : `${domain}-files.zip`;
  const headers: HeadersInit = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, '\\"')}"`,
  };

  // Dev: files live inside the container. Copy each to a host tmpdir first.
  if (process.env.USE_DOCKER === "true") {
    const container = process.env.CONTAINER_NAME ?? "panel-server";
    const stage = await mkdtemp(join(tmpdir(), "rinpanel-zip-"));
    try {
      for (const t of targets) {
        await new Promise<void>((resolve, reject) => {
          const p = spawn("docker", ["cp", `${container}:${t.abs}`, join(stage, basename(t.abs))]);
          let err = "";
          p.stderr.on("data", (c) => { err += c.toString(); });
          p.on("close", (code) => code === 0 ? resolve() : reject(new Error(err || `docker cp exit ${code}`)));
          p.on("error", reject);
        });
      }
    } catch (e) {
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      return new Response((e as Error).message || "staging failed", { status: 500 });
    }
    return streamZip(stage, targets, headers, async () => {
      await rm(stage, { recursive: true, force: true }).catch(() => {});
    });
  }

  // Prod: files are on the host directly.
  return streamZip(null, targets, headers);
}

async function streamZip(
  stageDir: string | null,
  targets: Array<{ rel: string; abs: string }>,
  headers: HeadersInit,
  cleanup?: () => Promise<void>,
): Promise<Response> {
  const archive = archiver("zip", { zlib: { level: 6 } });

  // Append each target to the archive. For dirs use `.directory()`, for files
  // use `.file()`.
  for (const t of targets) {
    const sourcePath = stageDir ? join(stageDir, basename(t.abs)) : t.abs;
    let isDir = false;
    try { isDir = (await stat(sourcePath)).isDirectory(); } catch { /* skip missing */ continue; }
    const archiveName = basename(t.rel) || basename(t.abs);
    if (isDir) {
      archive.directory(sourcePath, archiveName);
    } else {
      archive.file(sourcePath, { name: archiveName });
    }
  }

  // Finalize triggers compression; the readable stream emits chunks.
  void archive.finalize();
  // Pipe cleanup once stream finishes (success or error).
  if (cleanup) {
    archive.on("end", () => { void cleanup(); });
    archive.on("error", () => { void cleanup(); });
  }

  return new Response(archive as unknown as ReadableStream, { headers });
}
