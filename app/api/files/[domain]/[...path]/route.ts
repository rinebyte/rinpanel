import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auth } from "@/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { validatePath } from "@/lib/fs/path";

const MIME: Record<string, string> = {
  // images
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon",
  // video
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mkv: "video/x-matroska", ogv: "video/ogg", m4v: "video/x-m4v",
  // audio
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
  m4a: "audio/mp4", flac: "audio/flac", opus: "audio/opus",
  // text / web
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  // docs
  pdf: "application/pdf",
  // fonts
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ domain: string; path: string[] }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const { domain, path } = await ctx.params;
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  if (!row) return new Response("domain not found", { status: 404 });

  const relPath = path.join("/");
  const v = validatePath(domain, relPath);
  if (!v.ok) return new Response(v.reason, { status: 400 });

  const filename = path[path.length - 1] ?? "download";
  const wantsDownload = req.nextUrl.searchParams.get("dl") === "1";
  const mime = mimeFor(filename);
  // Quote filename in Content-Disposition per RFC 6266; basic escape of " and \.
  const safeName = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const headers: HeadersInit = {
    "Content-Type": mime,
    "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${safeName}"`,
    // Allow browsers to cache short-term so previews + repeats don't re-fetch.
    "Cache-Control": "private, max-age=60",
  };

  if (process.env.USE_DOCKER === "true") {
    const container = process.env.CONTAINER_NAME ?? "panel-server";
    const dir = await mkdtemp(join(tmpdir(), "rinpanel-dl-"));
    const tmp = join(dir, "f");
    try {
      await new Promise<void>((res, rej) => {
        const p = spawn("docker", ["cp", `${container}:${v.absolute}`, tmp]);
        let err = "";
        p.stderr.on("data", (c) => { err += c.toString(); });
        p.on("close", (code) => code === 0 ? res() : rej(new Error(err || `docker cp exit ${code}`)));
        p.on("error", rej);
      });
    } catch (e) {
      return new Response((e as Error).message || "file not found", { status: 404 });
    }
    const stream = createReadStream(tmp);
    stream.on("close", () => { void unlink(tmp); });
    return new Response(stream as unknown as ReadableStream, { headers });
  }

  try {
    return new Response(createReadStream(v.absolute) as unknown as ReadableStream, { headers });
  } catch {
    return new Response("file not found", { status: 404 });
  }
}
