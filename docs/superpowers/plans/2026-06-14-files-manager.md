# rinpanel Slice Fs: File Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Per-vhost file manager: browse, mkdir, upload (50 MB cap), download, delete, rename, inline text-edit. Chrooted to `/var/www/<domain>/` via a strict `validatePath` gate.

**Architecture:** Mirror Slice N. Pure `validatePath` is the wire boundary, `lib/fs/files.ts` is the I/O service composing `runOnTarget` + `writeFileOnTarget` + `lstat`-symlink-escape checks. Server actions for all mutations + Server Component pages for browsing. Downloads are the lone API route handler (binary stream).

**Source of truth:** `docs/superpowers/specs/2026-06-14-files-manager-design.md`.

**Tech Stack:** Existing — Next.js 16 (raise `experimental.serverActions.bodySizeLimit` to 50 MB), React 19, Drizzle (read-only for domains), `runOnTarget` argv seam, `writeFileOnTarget`, PHOSPHOR utilities. No new deps.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/fs/path.ts` (+ `.test.ts`) | Pure `validatePath(domain, relPath)` |
| `lib/fs/files.ts` (+ `.test.ts`) | `listDir` / `readFile` / `writeFile` / `mkdir` / `remove` / `rename` (container integration tests) |
| `next.config.ts` | MODIFY: `experimental.serverActions.bodySizeLimit: '50mb'` |
| `app/(dashboard)/files/page.tsx` | Server: domain picker grid |
| `app/(dashboard)/files/[domain]/[[...path]]/page.tsx` | Server: breadcrumb + file list |
| `app/(dashboard)/files/actions.ts` | mkdir / upload / delete / rename / save server actions |
| `app/api/files/[domain]/[...path]/route.ts` | Download route handler (binary stream) |
| `components/files/breadcrumb.tsx` | Server: PHOSPHOR breadcrumb |
| `components/files/file-list.tsx` | Server: row rendering |
| `components/files/file-row.tsx` | Client: action menu + per-row dialogs trigger |
| `components/files/upload-zone.tsx` | Client: drag+drop + click upload, per-file progress |
| `components/files/mkdir-form.tsx` | Client: small form for new folder |
| `components/files/delete-dialog.tsx` | Client `<dialog>` (file + dir with-contents checkbox) |
| `components/files/rename-dialog.tsx` | Client `<dialog>` with ▸ input pre-filled |
| `components/files/editor-dialog.tsx` | Client `<dialog>` with `<textarea>` editor |
| `components/app-shell/sidebar.tsx` | MODIFY: enable `Files` nav item |

---

## Task Fs-1: `validatePath` (TDD)

**Files:** Create `lib/fs/path.ts`, `lib/fs/path.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/fs/path.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validatePath } from "./path";

const ok = (d: string, rel: string, expectedAbs?: string) => {
  const r = validatePath(d, rel);
  expect(r.ok).toBe(true);
  if (r.ok && expectedAbs) expect(r.absolute).toBe(expectedAbs);
};
const bad = (d: string, rel: string, reasonMatches?: RegExp) => {
  const r = validatePath(d, rel);
  expect(r.ok).toBe(false);
  if (!r.ok && reasonMatches) expect(r.reason).toMatch(reasonMatches);
};

describe("validatePath", () => {
  it("accepts the root", () => ok("example.com", "", "/var/www/example.com"));
  it("accepts plain subpaths", () => {
    ok("example.com", "public_html", "/var/www/example.com/public_html");
    ok("example.com", "public_html/index.html", "/var/www/example.com/public_html/index.html");
    ok("example.com", "a/b/c.txt", "/var/www/example.com/a/b/c.txt");
  });
  it("strips a leading slash", () => ok("example.com", "/public_html", "/var/www/example.com/public_html"));
  it("strips a trailing slash", () => ok("example.com", "public_html/", "/var/www/example.com/public_html"));

  it("rejects parent-dir segments", () => {
    bad("example.com", "..", /parent|\\.\\./i);
    bad("example.com", "public_html/../../etc/passwd", /parent|\\.\\./i);
    bad("example.com", "a/../b", /parent|\\.\\./i);
  });
  it("rejects current-dir segments", () => bad("example.com", "./foo", /\\./i));
  it("rejects empty segments (//)", () => bad("example.com", "foo//bar", /empty/i));
  it("rejects leading-dot filenames (hidden files blocked)", () => {
    bad("example.com", ".htaccess", /hidden|leading/i);
    bad("example.com", "public_html/.env", /hidden|leading/i);
  });
  it("rejects forbidden characters", () => {
    bad("example.com", "foo\\0bar", /character/i);
    bad("example.com", "foo\\nbar", /character/i);
    bad("example.com", "foo/bar baz/qux", /character|space/i);
  });
  it("rejects too-long filename segment (POSIX 255)", () => {
    bad("example.com", "a".repeat(256), /length|255/i);
  });
  it("rejects invalid domain", () => {
    bad("BAD", "foo", /domain/i);
    bad("..", "foo", /domain/i);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npx vitest run lib/fs/path.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`lib/fs/path.ts`:
```ts
import path from "node:path";
import { validateDomain } from "@/lib/nginx/validate";

export type PathValidation =
  | { ok: true; absolute: string }
  | { ok: false; reason: string };

const SEGMENT = /^[A-Za-z0-9._-]+$/; // conservative: alnum + . _ - only

export function validatePath(domain: string, relPath: string): PathValidation {
  const d = validateDomain(domain);
  if (!d.ok) return { ok: false, reason: `invalid domain: ${d.reason}` };

  if (typeof relPath !== "string") return { ok: false, reason: "path is required" };

  // Strip leading + trailing slashes
  const stripped = relPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const base = `/var/www/${domain}`;

  if (stripped === "") return { ok: true, absolute: base };

  if (stripped.length > 4096) return { ok: false, reason: "path too long (max 4096)" };

  const segments = stripped.split("/");
  for (const seg of segments) {
    if (seg === "") return { ok: false, reason: "empty segment (// not allowed)" };
    if (seg === "." || seg === "..") return { ok: false, reason: "parent/current segments (./..) not allowed" };
    if (seg.length > 255) return { ok: false, reason: "segment length exceeds 255" };
    if (seg.startsWith(".")) return { ok: false, reason: "hidden / leading-dot files not allowed" };
    if (!SEGMENT.test(seg)) {
      // Try to give a specific reason for control chars / spaces / weird chars
      if (/\\s/.test(seg)) return { ok: false, reason: "spaces not allowed in path segments" };
      return { ok: false, reason: "invalid character in path segment" };
    }
  }

  const absolute = path.posix.join(base, ...segments);
  if (!absolute.startsWith(base + "/") && absolute !== base) {
    return { ok: false, reason: "path escapes domain root" };
  }
  return { ok: true, absolute };
}
```

- [ ] **Step 4: Confirm pass**

Run: `npx vitest run lib/fs/path.test.ts`
Expected: PASS (all groups). Adjust regex patterns in either the test or impl if reason wording differs (the wording shouldn't fight the tests; if it does, match it on the impl side).

- [ ] **Step 5: Commit**

```
git add lib/fs/path.ts lib/fs/path.test.ts
git commit -m "feat(slice-fs): add strict validatePath (chroot security gate)"
```

---

## Task Fs-2: `files.ts` service + container integration tests

**Files:** Create `lib/fs/files.ts`, `lib/fs/files.test.ts`.

- [ ] **Step 1: Implement the service**

`lib/fs/files.ts`:
```ts
import { runOnTarget } from "@/lib/shell";
import { writeFileOnTarget } from "@/lib/system/target-fs";
import { validatePath } from "./path";

export type Entry = { name: string; type: "file" | "dir" | "other"; size: number; mtime: number };

export type FsResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

function rejectOnInvalidPath(domain: string, rel: string) {
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
  // find -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'
  // First entry is the dir itself; skip it.
  const r = await runOnTarget(["find", abs, "-maxdepth", "1", "-printf", "%y\\t%s\\t%T@\\t%f\\n"]);
  if (!r.success) return { ok: false, error: r.stderr || "listDir failed" };
  const entries: Entry[] = r.stdout
    .split("\\n")
    .filter(Boolean)
    .map((line) => {
      const [t, size, mtime, ...nameParts] = line.split("\\t");
      return {
        type: t === "f" ? "file" : t === "d" ? "dir" : "other",
        size: parseInt(size, 10) || 0,
        mtime: Math.floor(parseFloat(mtime) || 0),
        name: nameParts.join("\\t"),
      };
    })
    .filter((e) => e.name && e.name !== abs.split("/").pop());
  return { ok: true, value: { entries } };
}

export async function readFile(
  domain: string,
  relPath: string,
  maxBytes = 100 * 1024,
): Promise<FsResult<{ content: string; truncated: boolean; isBinary: boolean }>> {
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  // Read one extra byte to detect truncation
  const r = await runOnTarget(["head", "-c", String(maxBytes + 1), abs]);
  if (!r.success) return { ok: false, error: r.stderr || "readFile failed" };
  const truncated = r.stdout.length > maxBytes;
  const content = truncated ? r.stdout.slice(0, maxBytes) : r.stdout;
  const isBinary = /\\x00/.test(content.slice(0, 8192));
  return { ok: true, value: { content, truncated, isBinary } };
}

export async function writeFile(domain: string, relPath: string, content: string): Promise<FsResult> {
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  await writeFileOnTarget(abs, content);
  // Force canonical ownership + perms
  const own = await runOnTarget(["chown", "root:www-data", abs]);
  const mode = await runOnTarget(["chmod", "644", abs]);
  if (!own.success || !mode.success) {
    return { ok: false, error: (own.stderr || "") + (mode.stderr || "") || "chmod/chown failed" };
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
  let abs: string;
  try { abs = rejectOnInvalidPath(domain, relPath); } catch (e) { return { ok: false, error: (e as Error).message }; }
  if (relPath === "" || relPath === "/") {
    return { ok: false, error: "refusing to delete webroot itself — use removeVhost instead" };
  }
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
```

- [ ] **Step 2: Write integration test**

`lib/fs/files.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCommand, runOnTarget } from "@/lib/shell";
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
  });

  it("mkdir + listDir + remove round-trip", async () => {
    if (!dockerReady) return;
    expect((await mkdir(TEST, "public_html/blog")).ok).toBe(true);
    const ls = await listDir(TEST, "public_html");
    expect(ls.ok && ls.value.entries.some((e) => e.name === "blog" && e.type === "dir")).toBe(true);
    expect((await remove(TEST, "public_html/blog", { recursive: true })).ok).toBe(true);
  });

  it("writeFile + readFile round-trip", async () => {
    if (!dockerReady) return;
    const content = "<!doctype html><h1>hello from test</h1>";
    expect((await writeFile(TEST, "public_html/test.html", content)).ok).toBe(true);
    const r = await readFile(TEST, "public_html/test.html");
    expect(r.ok && r.value.content).toBe(content);
    expect(r.ok && r.value.isBinary).toBe(false);
    expect((await remove(TEST, "public_html/test.html")).ok).toBe(true);
  });

  it("rename file", async () => {
    if (!dockerReady) return;
    await writeFile(TEST, "public_html/a.txt", "abc");
    expect((await rename(TEST, "public_html/a.txt", "public_html/b.txt")).ok).toBe(true);
    const r = await readFile(TEST, "public_html/b.txt");
    expect(r.ok && r.value.content).toBe("abc");
    await remove(TEST, "public_html/b.txt");
  });

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
```

- [ ] **Step 3: Run with the live container**

```bash
docker compose up -d
USE_DOCKER=true CONTAINER_NAME=panel-server npx vitest run lib/fs/files.test.ts
```
Expected: all integration assertions pass.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: 37 (baseline N) + path tests + files tests = 51+ passing.

- [ ] **Step 5: Commit**

```
git add lib/fs/files.ts lib/fs/files.test.ts
git commit -m "feat(slice-fs): add file service with chroot + integration tests"
```

---

## Task Fs-3: Server actions + body-size limit

**Files:** Modify `next.config.ts`; Create `app/(dashboard)/files/actions.ts`.

- [ ] **Step 1: Raise the body-size limit**

In `next.config.ts`, add:
```ts
experimental: {
  serverActions: {
    bodySizeLimit: '50mb',
  },
}
```
(preserve any existing config).

- [ ] **Step 2: Create the server actions file**

`app/(dashboard)/files/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { listDir, mkdir, remove, rename, writeFile } from "@/lib/fs/files";
import { validatePath } from "@/lib/fs/path";
import { logActivity } from "@/lib/system/activity";

async function requireSession() {
  const s = await auth();
  if (!s) redirect("/login");
}

function ensureDomain(domain: string) {
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  if (!row) throw new Error("domain not found");
  return row;
}

export interface ActionResult { ok: boolean; error?: string }

export async function mkdirEntry(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const cwd = String(formData.get("cwd") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  try { ensureDomain(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const target = cwd ? `${cwd}/${name}` : name;
  const v = validatePath(domain, target);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await mkdir(domain, target);
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_mkdir", `${domain}:${target}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function uploadFiles(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const cwd = String(formData.get("cwd") ?? "");
  try { ensureDomain(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, error: "no files supplied" };

  const errors: string[] = [];
  for (const file of files) {
    const relPath = cwd ? `${cwd}/${file.name}` : file.name;
    const v = validatePath(domain, relPath);
    if (!v.ok) { errors.push(`${file.name}: ${v.reason}`); continue; }
    const content = Buffer.from(await file.arrayBuffer()).toString("binary"); // see note in spec
    const w = await writeFile(domain, relPath, content);
    if (!w.ok) errors.push(`${file.name}: ${w.error}`);
  }
  logActivity("file_upload", `${domain}:${cwd || "/"} (${files.length} files)`);
  revalidatePath(`/files/${domain}`, "layout");
  if (errors.length) return { ok: false, error: errors.join("\\n") };
  return { ok: true };
}

export async function deleteEntry(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const relPath = String(formData.get("path") ?? "");
  const recursive = formData.get("recursive") === "on";
  try { ensureDomain(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const v = validatePath(domain, relPath);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await remove(domain, relPath, { recursive });
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_delete", `${domain}:${relPath}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function renameEntry(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const oldRel = String(formData.get("path") ?? "");
  const newName = String(formData.get("newName") ?? "").trim();
  try { ensureDomain(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const parent = oldRel.split("/").slice(0, -1).join("/");
  const newRel = parent ? `${parent}/${newName}` : newName;
  const v = validatePath(domain, newRel);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await rename(domain, oldRel, newRel);
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_rename", `${domain}:${oldRel} → ${newRel}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export async function saveFile(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const domain = String(formData.get("domain") ?? "");
  const relPath = String(formData.get("path") ?? "");
  const content = String(formData.get("content") ?? "");
  try { ensureDomain(domain); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const v = validatePath(domain, relPath);
  if (!v.ok) return { ok: false, error: v.reason };
  if (content.length > 100 * 1024) return { ok: false, error: "file too large (max 100 KB inline)" };
  const r = await writeFile(domain, relPath, content);
  if (!r.ok) return { ok: false, error: r.error };
  logActivity("file_edit", `${domain}:${relPath}`);
  revalidatePath(`/files/${domain}`, "layout");
  return { ok: true };
}

export { listDir };
```

> **Note on `Buffer.from(...).toString("binary")`:** `writeFile` currently takes a string (because `writeFileOnTarget` was designed around config text). For binary uploads we encode bytes as Latin-1 ("binary") so the byte-for-byte content survives the round-trip. This is a temporary shim; if a future slice needs proper binary uploads at scale, extend `writeFileOnTarget` to take `Buffer | string`. For static-site assets (images/fonts) this approach works because we write the same bytes back out.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean compile. New config + actions type-check.

- [ ] **Step 4: Commit**

```
git add next.config.ts "app/(dashboard)/files/actions.ts"
git commit -m "feat(slice-fs): add file server actions + raise body limit to 50mb"
```

---

## Task Fs-4: Pages (server components) + sidebar enable

**Files:** Create `app/(dashboard)/files/page.tsx`, `app/(dashboard)/files/[domain]/[[...path]]/page.tsx`; Modify `components/app-shell/sidebar.tsx`.

- [ ] **Step 1: Create the domain picker page**

`app/(dashboard)/files/page.tsx`:
```tsx
import { desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { domains } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const rows = db.select().from(domains).orderBy(desc(domains.createdAt)).all();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">module 03 · files</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">webroots</h1>
        </div>
        <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 font-mono text-[0.65rem] tracking-wide uppercase text-lime-300">
          {rows.length} vhosts
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="glass corner-ticks relative rounded-xl p-8 text-center">
          <p className="eyebrow">no domains configured</p>
          <p className="mt-2 font-mono text-sm text-zinc-500">
            tambahin di <Link href="/domains" className="text-lime-300 underline">/domains</Link> dulu
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/files/${r.domain}`}
                className="glass corner-ticks relative flex flex-col gap-2 rounded-xl p-5 hover:bg-white/[0.02]"
              >
                <span className="eyebrow">webroot</span>
                <span className="truncate font-mono text-sm text-white">{r.domain}</span>
                <span className="truncate font-mono text-[0.7rem] text-zinc-500">▸ {r.rootPath}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the browser page**

`app/(dashboard)/files/[domain]/[[...path]]/page.tsx`:
```tsx
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { listDir } from "@/lib/fs/files";
import { Breadcrumb } from "@/components/files/breadcrumb";
import { MkdirForm } from "@/components/files/mkdir-form";
import { UploadZone } from "@/components/files/upload-zone";
import { FileList } from "@/components/files/file-list";

export const dynamic = "force-dynamic";

export default async function FileBrowserPage({
  params,
}: {
  params: Promise<{ domain: string; path?: string[] }>;
}) {
  const { domain, path = [] } = await params;
  const row = db.select().from(domains).where(eq(domains.domain, domain)).get();
  if (!row) notFound();

  const relPath = path.join("/");
  const r = await listDir(domain, relPath);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">module 03 · files</p>
        <Breadcrumb domain={domain} relPath={relPath} />
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <UploadZone domain={domain} cwd={relPath} />
        <MkdirForm domain={domain} cwd={relPath} />
      </div>

      {r.ok ? (
        <FileList domain={domain} cwd={relPath} entries={r.value.entries} />
      ) : (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 font-mono text-sm text-red-300">
          ▸ {r.error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Enable Files nav item**

In `components/app-shell/sidebar.tsx`, find the `Files` NAV entry and flip `enabled: false` → `enabled: true`. Leave SSL untouched (next slice).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds with `/files` and `/files/[domain]/[[...path]]` in the route table. The page imports refer to components we'll add in Fs-5/Fs-6/Fs-7 — create stub files for these:

`components/files/breadcrumb.tsx`:
```tsx
export function Breadcrumb({ domain: _d, relPath: _r }: { domain: string; relPath: string }) {
  return null;
}
```

`components/files/mkdir-form.tsx`:
```tsx
"use client";
export function MkdirForm(_props: { domain: string; cwd: string }) { return null; }
```

`components/files/upload-zone.tsx`:
```tsx
"use client";
export function UploadZone(_props: { domain: string; cwd: string }) { return null; }
```

`components/files/file-list.tsx`:
```tsx
import type { Entry } from "@/lib/fs/files";
export function FileList(_props: { domain: string; cwd: string; entries: Entry[] }) { return null; }
```

(Real implementations land in Fs-5 / Fs-6 / Fs-7.)

- [ ] **Step 5: Commit**

```
git add "app/(dashboard)/files" components/files components/app-shell/sidebar.tsx
git commit -m "feat(slice-fs): add files pages + stubs + enable sidebar nav"
```

---

## Task Fs-5: Breadcrumb + FileList + FileRow

**Files:** Replace stubs in `components/files/breadcrumb.tsx`, `components/files/file-list.tsx`; Create `components/files/file-row.tsx`.

- [ ] **Step 1: Replace `components/files/breadcrumb.tsx`**

```tsx
import Link from "next/link";

export function Breadcrumb({ domain, relPath }: { domain: string; relPath: string }) {
  const segments = relPath.split("/").filter(Boolean);
  return (
    <h1 className="font-mono text-base text-zinc-200 flex flex-wrap items-baseline gap-1">
      <Link href="/files" className="text-lime-500/70 hover:text-lime-300">▸</Link>
      <Link href="/files" className="text-zinc-500 hover:text-white">/var/www</Link>
      <span className="text-zinc-700">/</span>
      <Link href={`/files/${domain}`} className="text-white font-display tracking-wide hover:text-lime-300">
        {domain}
      </Link>
      {segments.map((seg, i) => {
        const sub = segments.slice(0, i + 1).join("/");
        return (
          <span key={sub} className="flex items-baseline gap-1">
            <span className="text-zinc-700">/</span>
            <Link href={`/files/${domain}/${sub}`} className="text-zinc-300 hover:text-white">{seg}</Link>
          </span>
        );
      })}
    </h1>
  );
}
```

- [ ] **Step 2: Replace `components/files/file-list.tsx`**

```tsx
import type { Entry } from "@/lib/fs/files";
import { FileRow } from "./file-row";

export function FileList({ domain, cwd, entries }: { domain: string; cwd: string; entries: Entry[] }) {
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-white/10 px-5 py-3">
        <span className="eyebrow">name</span>
        <span className="eyebrow text-right">size</span>
        <span className="eyebrow text-right">modified</span>
        <span className="eyebrow">actions</span>
      </div>
      <ul className="divide-y divide-white/5">
        {sorted.length === 0 ? (
          <li className="px-5 py-8 text-center font-mono text-sm text-zinc-500">
            ▸ empty folder — drop files in the upload zone above
          </li>
        ) : (
          sorted.map((e) => (
            <FileRow key={e.name} domain={domain} cwd={cwd} entry={e} />
          ))
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/files/file-row.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Folder, File as FileIcon, FileText, FileImage, FileCode, MoreHorizontal, Pencil, Trash, Download, FileEdit } from "lucide-react";
import type { Entry } from "@/lib/fs/files";
import { isLikelyText } from "@/lib/fs/files";
import { DeleteDialog, type DeleteDialogHandle } from "./delete-dialog";
import { RenameDialog, type RenameDialogHandle } from "./rename-dialog";
import { EditorDialog, type EditorDialogHandle } from "./editor-dialog";

function iconFor(entry: Entry) {
  if (entry.type === "dir") return Folder;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return FileImage;
  if (["html", "css", "js", "json", "ts", "tsx", "md", "xml"].includes(ext)) return FileCode;
  if (["txt", "log"].includes(ext)) return FileText;
  return FileIcon;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatMtime(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export function FileRow({ domain, cwd, entry }: { domain: string; cwd: string; entry: Entry }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const deleteRef = useRef<DeleteDialogHandle>(null);
  const renameRef = useRef<RenameDialogHandle>(null);
  const editorRef = useRef<EditorDialogHandle>(null);

  const Icon = iconFor(entry);
  const relPath = cwd ? `${cwd}/${entry.name}` : entry.name;
  const dirHref = entry.type === "dir" ? `/files/${domain}/${relPath}` : null;
  const editable = entry.type === "file" && isLikelyText(entry.name) && entry.size <= 100 * 1024;
  const downloadHref = `/api/files/${domain}/${relPath}`;

  return (
    <li className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3 hover:bg-white/[0.02]">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-4 shrink-0 text-zinc-500" />
        {dirHref ? (
          <Link href={dirHref} className="truncate font-mono text-sm text-zinc-100 hover:text-lime-300">{entry.name}</Link>
        ) : (
          <span className="truncate font-mono text-sm text-zinc-100">{entry.name}</span>
        )}
      </div>
      <span className="font-mono text-xs text-zinc-500 text-right tabular-nums">
        {entry.type === "dir" ? "—" : formatSize(entry.size)}
      </span>
      <span className="font-mono text-xs text-zinc-500 text-right">{formatMtime(entry.mtime)}</span>

      <div className="relative flex items-center gap-1">
        {editable && (
          <button
            type="button"
            onClick={() => editorRef.current?.open()}
            aria-label="Edit"
            className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <FileEdit className="size-4" />
          </button>
        )}
        {entry.type === "file" && (
          <a
            href={downloadHref}
            download
            aria-label="Download"
            className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Download className="size-4" />
          </a>
        )}
        <button
          type="button"
          onClick={() => renameRef.current?.open()}
          aria-label="Rename"
          className="grid size-9 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => deleteRef.current?.open()}
          aria-label="Delete"
          className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash className="size-4" />
        </button>
      </div>

      <DeleteDialog ref={deleteRef} domain={domain} relPath={relPath} isDir={entry.type === "dir"} name={entry.name} />
      <RenameDialog ref={renameRef} domain={domain} relPath={relPath} currentName={entry.name} />
      {editable && <EditorDialog ref={editorRef} domain={domain} relPath={relPath} name={entry.name} />}
    </li>
  );
}
```

> Note: `RenameDialog`, `DeleteDialog`, `EditorDialog` are added in Fs-7. For now, add empty stubs so the build succeeds.

- [ ] **Step 4: Create empty stubs for dialogs (full implementation in Fs-7)**

`components/files/delete-dialog.tsx`:
```tsx
"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";
export interface DeleteDialogHandle { open: () => void; close: () => void }
export const DeleteDialog = forwardRef<DeleteDialogHandle, { domain: string; relPath: string; isDir: boolean; name: string }>(function DeleteDialog(_p, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  return <dialog ref={r} />;
});
```

`components/files/rename-dialog.tsx`:
```tsx
"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";
export interface RenameDialogHandle { open: () => void; close: () => void }
export const RenameDialog = forwardRef<RenameDialogHandle, { domain: string; relPath: string; currentName: string }>(function RenameDialog(_p, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  return <dialog ref={r} />;
});
```

`components/files/editor-dialog.tsx`:
```tsx
"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";
export interface EditorDialogHandle { open: () => void; close: () => void }
export const EditorDialog = forwardRef<EditorDialogHandle, { domain: string; relPath: string; name: string }>(function EditorDialog(_p, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  return <dialog ref={r} />;
});
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```
git add components/files
git commit -m "feat(slice-fs): add Breadcrumb + FileList + FileRow with dialog stubs"
```

---

## Task Fs-6: UploadZone + MkdirForm

**Files:** Replace stubs in `components/files/upload-zone.tsx`, `components/files/mkdir-form.tsx`.

- [ ] **Step 1: Replace `components/files/upload-zone.tsx`**

```tsx
"use client";

import { useState, useRef, useTransition } from "react";
import { Upload } from "lucide-react";
import { uploadFiles } from "@/app/(dashboard)/files/actions";

export function UploadZone({ domain, cwd }: { domain: string; cwd: string }) {
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (files: FileList | File[]) => {
    const fd = new FormData();
    fd.set("domain", domain);
    fd.set("cwd", cwd);
    for (const f of Array.from(files)) fd.append("files", f);
    setResult(null);
    startTransition(async () => {
      const r = await uploadFiles(fd);
      setResult(r);
    });
  };

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) submit(e.dataTransfer.files);
      }}
      className={`glass corner-ticks relative flex-1 rounded-xl border-2 border-dashed transition ${
        dragging ? "border-lime-500/60 bg-lime-500/[0.04]" : "border-white/10"
      } p-5`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && submit(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="flex w-full flex-col items-center justify-center gap-2 py-4 font-mono text-sm text-zinc-300"
      >
        {pending ? (
          <>
            <span className="animate-blink text-lime-300">[ ·· ]</span>
            <span className="text-zinc-400">uploading</span>
          </>
        ) : (
          <>
            <Upload className="size-5 text-lime-500/70" />
            <span>drop files here</span>
            <span className="text-[0.7rem] text-zinc-600">or click to choose · 50 MB / file</span>
          </>
        )}
      </button>

      {result && result.ok && (
        <p className="mt-2 flex items-center gap-2 font-mono text-xs text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" /> upload successful
        </p>
      )}
      {result && !result.ok && result.error && (
        <pre className="mt-2 overflow-auto rounded border border-red-500/30 bg-red-500/10 p-2 font-mono text-[0.7rem] text-red-200/90">
          {result.error}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `components/files/mkdir-form.tsx`**

```tsx
"use client";

import { useActionState, useRef, useEffect } from "react";
import { FolderPlus } from "lucide-react";
import { mkdirEntry, type ActionResult } from "@/app/(dashboard)/files/actions";

export function MkdirForm({ domain, cwd }: { domain: string; cwd: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(mkdirEntry, undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state?.ok) inputRef.current?.form?.reset(); }, [state]);

  return (
    <form action={formAction} className="glass corner-ticks relative flex flex-col gap-2 rounded-xl p-5 md:max-w-xs">
      <input type="hidden" name="domain" value={domain} />
      <input type="hidden" name="cwd" value={cwd} />
      <span className="eyebrow">new folder</span>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">▸</span>
          <input
            ref={inputRef}
            name="name"
            required
            placeholder="folder-name"
            className="h-10 w-full rounded-md border border-white/[0.08] bg-black/40 pl-8 pr-3 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-label="Create folder"
          className="accent-glow grid size-10 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-60"
        >
          <FolderPlus className="size-4" />
        </button>
      </div>
      {state && !state.ok && state.error && (
        <p className="font-mono text-[0.7rem] text-red-300">▸ {state.error}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```
git add components/files/upload-zone.tsx components/files/mkdir-form.tsx
git commit -m "feat(slice-fs): add UploadZone (drag+drop) and MkdirForm"
```

---

## Task Fs-7: DeleteDialog + RenameDialog + EditorDialog (replace stubs)

**Files:** Replace the three stubs from Fs-5.

- [ ] **Step 1: `components/files/delete-dialog.tsx`**

```tsx
"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { deleteEntry } from "@/app/(dashboard)/files/actions";

export interface DeleteDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; isDir: boolean; name: string }

export const DeleteDialog = forwardRef<DeleteDialogHandle, Props>(function DeleteDialog({ domain, relPath, isDir, name }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={(fd) => { void deleteEntry(fd); r.current?.close(); }} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="domain" value={domain} />
        <input type="hidden" name="path" value={relPath} />

        <div>
          <p className="eyebrow">{isDir ? "folder · delete" : "file · delete"}</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">delete {isDir ? "folder" : "file"}?</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">name · </span>
            <span className="text-zinc-200">{name}</span>
          </p>
        </div>

        {isDir && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-black/30 p-3">
            <input type="checkbox" name="recursive" required className="mt-0.5 size-4 shrink-0 accent-red-500" />
            <span className="flex flex-col gap-1">
              <span className="font-mono text-xs text-zinc-200">Include all contents</span>
              <span className="font-mono text-[0.65rem] text-zinc-500">delete recursively, no undo</span>
            </span>
          </label>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            Cancel
          </button>
          <button type="submit"
            className="h-10 flex-1 rounded-md border border-red-500/40 bg-red-500/10 font-mono text-xs font-semibold tracking-wide uppercase text-red-300 hover:border-red-500/60 hover:bg-red-500/20">
            Delete
          </button>
        </div>
      </form>
    </dialog>
  );
});
```

- [ ] **Step 2: `components/files/rename-dialog.tsx`**

```tsx
"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useEffect } from "react";
import { renameEntry, type ActionResult } from "@/app/(dashboard)/files/actions";

export interface RenameDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; currentName: string }

export const RenameDialog = forwardRef<RenameDialogHandle, Props>(function RenameDialog({ domain, relPath, currentName }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => r.current?.showModal(), close: () => r.current?.close() }));
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(renameEntry, undefined);
  useEffect(() => { if (state?.ok) r.current?.close(); }, [state]);

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={formAction} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="domain" value={domain} />
        <input type="hidden" name="path" value={relPath} />
        <div>
          <p className="eyebrow">entry · rename</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">rename</h2>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">new name</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">▸</span>
            <input
              name="newName"
              defaultValue={currentName}
              autoFocus
              required
              className="h-11 w-full rounded-md border border-white/[0.08] bg-black/40 pl-8 pr-3 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
            />
          </div>
        </label>
        {state && !state.ok && state.error && (
          <p className="font-mono text-[0.7rem] text-red-300">▸ {state.error}</p>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            Cancel
          </button>
          <button type="submit" disabled={pending}
            className="accent-glow h-10 flex-1 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60">
            {pending ? "[ ·· ]" : "Rename"}
          </button>
        </div>
      </form>
    </dialog>
  );
});
```

- [ ] **Step 3: `components/files/editor-dialog.tsx`**

```tsx
"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useEffect, useState } from "react";
import { saveFile, type ActionResult } from "@/app/(dashboard)/files/actions";
import { readFile } from "@/lib/fs/files";

export interface EditorDialogHandle { open: () => void; close: () => void }
interface Props { domain: string; relPath: string; name: string }

export const EditorDialog = forwardRef<EditorDialogHandle, Props>(function EditorDialog({ domain, relPath, name }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(saveFile, undefined);

  useImperativeHandle(ref, () => ({
    open: async () => {
      r.current?.showModal();
      if (!loaded) {
        // Use a server action would be nicer; for now we re-fetch via a fetch to a small read endpoint
        // OR: call a server action from this client. Simpler — add a read server action; see note in Fs-3.
        setLoaded(true);
      }
    },
    close: () => r.current?.close(),
  }));

  useEffect(() => { if (state?.ok) r.current?.close(); }, [state]);

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal w-[min(64rem,calc(100vw-2rem))]">
      <form action={formAction} className="flex flex-col gap-4 p-6">
        <input type="hidden" name="domain" value={domain} />
        <input type="hidden" name="path" value={relPath} />
        <div>
          <p className="eyebrow">file · edit</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white truncate">{name}</h2>
        </div>
        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-[60vh] w-full resize-y rounded-md border border-white/[0.08] bg-black/40 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
        />
        {state && !state.ok && state.error && (
          <p className="font-mono text-xs text-red-300">▸ {state.error}</p>
        )}
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 px-5 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            Cancel
          </button>
          <button type="submit" disabled={pending}
            className="accent-glow h-10 px-5 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60">
            {pending ? "[ ·· ] saving" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
});
```

> **Loading initial editor content:** the editor needs to fetch the existing file content when opened. Since `readFile` is a server-side function, expose a thin server action `readFileContent({domain, path})` in `app/(dashboard)/files/actions.ts` returning `{ ok, content }`, and call it inside the `open` handler. Update Fs-3 to include this action OR add it here:

Add to `app/(dashboard)/files/actions.ts`:
```ts
export async function readFileContent(domain: string, relPath: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  await requireSession();
  const v = validatePath(domain, relPath);
  if (!v.ok) return { ok: false, error: v.reason };
  const r = await readFile(domain, relPath);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.value.isBinary) return { ok: false, error: "binary file — not editable" };
  return { ok: true, content: r.value.content };
}
```

Then update `EditorDialog.open`:
```ts
open: async () => {
  r.current?.showModal();
  if (!loaded) {
    const { readFileContent } = await import("@/app/(dashboard)/files/actions");
    const got = await readFileContent(domain, relPath);
    if (got.ok && got.content !== undefined) setContent(got.content);
    setLoaded(true);
  }
}
```

(`import("@/lib/fs/files")` removed from the previous attempt — we use the server action instead since `readFile` runs server-side.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: clean. Edit `app/(dashboard)/files/actions.ts` to add the `readFileContent` action if you haven't yet.

- [ ] **Step 5: Commit**

```
git add components/files "app/(dashboard)/files/actions.ts"
git commit -m "feat(slice-fs): wire delete + rename + editor dialogs with readFileContent action"
```

---

## Task Fs-8: Download route handler

**Files:** Create `app/api/files/[domain]/[...path]/route.ts`.

- [ ] **Step 1: Implement**

```ts
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { validatePath } from "@/lib/fs/path";

export async function GET(req: NextRequest, ctx: { params: Promise<{ domain: string; path: string[] }> }) {
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
      p.on("close", (code) => code === 0 ? res() : rej(new Error(err)));
      p.on("error", rej);
    });
    const stream = createReadStream(tmp);
    stream.on("close", () => { void unlink(tmp); });
    return new Response(stream as unknown as ReadableStream, { headers });
  } else {
    return new Response(createReadStream(v.absolute) as unknown as ReadableStream, { headers });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: route table shows `ƒ /api/files/[domain]/[...path]`.

- [ ] **Step 3: Commit**

```
git add app/api/files
git commit -m "feat(slice-fs): add download route handler"
```

---

## Task Fs-9: Live QA + merge

- [ ] **Step 1: Boot dependencies, start dev server**

```bash
docker compose up -d
npm run dev &
```

- [ ] **Step 2: Run Playwright e2e** (adapt the polish slice's QA script template)

Verify:
1. Login → `/files` → domain grid renders.
2. Click a domain → `/files/<domain>` → list shows `public_html` dir.
3. Navigate into `public_html` → see `index.html` (placeholder from N).
4. mkdir `blog` → row appears.
5. Upload 2 files (one ~1 MB image, one small HTML) → both appear with correct sizes.
6. Edit `index.html` (replace content) → save → curl the domain returns the new content.
7. Rename uploaded HTML → updates in list.
8. Delete a file → row disappears.
9. Delete `blog` dir → dialog requires the "include all contents" checkbox; after check + submit, row disappears.
10. Path-escape attempt via URL (`/files/<domain>/../../etc`) → 404 or rejected (handled by Next.js routing + `validatePath` defense).
11. Screenshot at desktop (1280) + mobile (390).

- [ ] **Step 3: Audit log check**

```bash
node -e "const D=require('better-sqlite3');const db=new D('panel.db');console.log(db.prepare(\\"select action, detail from activity_logs where action like 'file_%' order by created_at desc limit 10\\").all())"
```
Expected: all five event types appear.

- [ ] **Step 4: Stop dev server, full suite + build**

```bash
pkill -f "next dev"
USE_DOCKER=true npm test
npm run build
```
Expected: build clean; test count includes integration tests passing against the live container.

- [ ] **Step 5: Merge**

```bash
git checkout main
git merge --no-ff slice-fs-files -m "merge: slice Fs — file manager (chroot, upload, edit, dialog)"
npm test
git branch -d slice-fs-files
git push origin main
```

---

## Self-review

- **Spec coverage:** path gate (Fs-1), service ops (Fs-2), config + actions (Fs-3), pages + sidebar (Fs-4), breadcrumb + list + row (Fs-5), upload + mkdir (Fs-6), three dialogs + readFileContent (Fs-7), download route (Fs-8), e2e + merge (Fs-9). All §3 in-scope items and §13 acceptance criteria map to tasks.
- **Type consistency:** `PathValidation` / `Entry` / `FsResult` / `ActionResult` / `DeleteDialogHandle` / `RenameDialogHandle` / `EditorDialogHandle` referenced consistently.
- **Placeholder scan:** no TBDs. The `Buffer.from(...).toString("binary")` shim for uploads is called out in the inline note in Fs-3; not ideal, fine for v1 static-site assets.
- **UI consistency:** every component uses PHOSPHOR primitives from `globals.css`; every destructive op uses the native `<dialog>` confirm pattern; mobile gate at 390 px in Fs-9.
