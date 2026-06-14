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

export async function GET(
  _req: NextRequest,
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
  const headers: HeadersInit = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Type": "application/octet-stream",
  };

  if (process.env.USE_DOCKER === "true") {
    const container = process.env.CONTAINER_NAME ?? "panel-server";
    const dir = await mkdtemp(join(tmpdir(), "rinpanel-dl-"));
    const tmp = join(dir, "f");
    await new Promise<void>((res, rej) => {
      const p = spawn("docker", ["cp", `${container}:${v.absolute}`, tmp]);
      let err = "";
      p.stderr.on("data", (c) => { err += c.toString(); });
      p.on("close", (code) => code === 0 ? res() : rej(new Error(err || `docker cp exit ${code}`)));
      p.on("error", rej);
    });
    const stream = createReadStream(tmp);
    stream.on("close", () => { void unlink(tmp); });
    return new Response(stream as unknown as ReadableStream, { headers });
  } else {
    return new Response(createReadStream(v.absolute) as unknown as ReadableStream, { headers });
  }
}
