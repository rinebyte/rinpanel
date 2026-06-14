import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCommand } from "@/lib/shell";
import { applyVhost, removeVhost } from "@/lib/nginx/vhost";
import { listDir, readFile, writeFile, mkdir, remove, rename, isLikelyText } from "./files";

const TEST = "rinpanel-fs-test.localdomain";

async function dockerUp(): Promise<boolean> {
  const r = await runCommand(["docker", "info"]);
  return r.success;
}

let dockerReady = false;
beforeAll(async () => {
  dockerReady = (await dockerUp()) && process.env.USE_DOCKER === "true";
  if (dockerReady) {
    await removeVhost(TEST, { wipeWebroot: true });
    const r = await applyVhost(TEST);
    if (!r.ok) throw new Error(`fixture vhost failed: ${r.error}`);
  } else {
    console.log("files.test: skipping — Docker not available / USE_DOCKER!=true");
  }
}, 60_000);

afterAll(async () => {
  if (dockerReady) await removeVhost(TEST, { wipeWebroot: true });
}, 30_000);

describe("isLikelyText", () => {
  it("returns true for html/css/js extensions", () => {
    expect(isLikelyText("index.html")).toBe(true);
    expect(isLikelyText("style.css")).toBe(true);
    expect(isLikelyText("app.js")).toBe(true);
  });
  it("returns false for binary extensions", () => {
    expect(isLikelyText("image.png")).toBe(false);
    expect(isLikelyText("font.woff2")).toBe(false);
  });
});

describe("files integration", () => {
  it("listDir on fresh vhost shows public_html", async () => {
    if (!dockerReady) return;
    const r = await listDir(TEST, "");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.entries.some((e) => e.name === "public_html" && e.type === "dir")).toBe(true);
    }
  }, 30_000);

  it("mkdir + listDir + remove round-trip", async () => {
    if (!dockerReady) return;
    expect((await mkdir(TEST, "public_html/blog")).ok).toBe(true);
    const ls = await listDir(TEST, "public_html");
    expect(ls.ok && (ls.value.entries.some((e) => e.name === "blog" && e.type === "dir"))).toBe(true);
    expect((await remove(TEST, "public_html/blog", { recursive: true })).ok).toBe(true);
  }, 30_000);

  it("writeFile + readFile round-trip", async () => {
    if (!dockerReady) return;
    const content = "<!doctype html><h1>hello from test</h1>";
    expect((await writeFile(TEST, "public_html/test.html", content)).ok).toBe(true);
    const r = await readFile(TEST, "public_html/test.html");
    expect(r.ok && r.value.content).toBe(content);
    expect(r.ok && r.value.isBinary).toBe(false);
    expect((await remove(TEST, "public_html/test.html")).ok).toBe(true);
  }, 30_000);

  it("rename file", async () => {
    if (!dockerReady) return;
    await writeFile(TEST, "public_html/a.txt", "abc");
    expect((await rename(TEST, "public_html/a.txt", "public_html/b.txt")).ok).toBe(true);
    const r = await readFile(TEST, "public_html/b.txt");
    expect(r.ok && r.value.content).toBe("abc");
    await remove(TEST, "public_html/b.txt");
  }, 30_000);

  it("refuses to delete webroot itself", async () => {
    if (!dockerReady) return;
    const r = await remove(TEST, "", { recursive: true });
    expect(r.ok).toBe(false);
  });

  it("refuses paths escaping the chroot", async () => {
    if (!dockerReady) return;
    const r = await writeFile(TEST, "../../../tmp/pwn", "bad");
    expect(r.ok).toBe(false);
  });
});
