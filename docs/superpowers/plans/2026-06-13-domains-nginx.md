# rinpanel Slice N: Domains & Nginx — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add CRUD UI for static-only Nginx vhosts — validated domain input flows through a service that writes config + symlink + placeholder, runs `nginx -t`, and reloads (with rollback on failure). First slice where HTTP input touches the shell, so validation is load-bearing.

**Architecture:** Pure `validateDomain` + `renderConfig` (TDD), a `target-fs` helper to write files into the container (USE_DOCKER-aware), a `vhost` service composing those + `runOnTarget` for `mkdir`/`ln`/`mv`/`rm`/`nginx -t`/`nginx -s reload`. Server actions only (no REST routes this slice). UI follows the consistency contract from `docs/superpowers/specs/2026-06-13-domains-nginx-design.md` §4.

**Tech Stack:** Existing — Next.js 16 App Router, NextAuth v5, Drizzle/SQLite, `runOnTarget` argv seam, PHOSPHOR utilities. No new deps.

**Source of truth:** `docs/superpowers/specs/2026-06-13-domains-nginx-design.md`. Pattern references: `app/(dashboard)/logout-action.ts` (server action shape), `components/app-shell/sidebar.tsx` (native `<dialog>` confirm pattern), `app/(auth)/login/page.tsx` (PHOSPHOR form patterns + ▸ caret + `[ ·· ]` pending state).

---

## File Structure

| File | Responsibility |
|---|---|
| `db/schema.ts` | MODIFY: add `updatedAt` to `domains` table |
| `lib/nginx/validate.ts` (+ `.test.ts`) | Pure `validateDomain(input)` — the security gate |
| `lib/nginx/render.ts` (+ `.test.ts`) | Pure `renderConfig(domain)` + `renderPlaceholderHtml(domain)` |
| `lib/system/target-fs.ts` (+ `.test.ts`) | `writeFileOnTarget(path, content)` — USE_DOCKER-aware file write |
| `lib/nginx/vhost.ts` (+ `.test.ts`) | `applyVhost` / `removeVhost` / `renameVhost` with rollback (integration test against container) |
| `app/(dashboard)/domains/page.tsx` | Server Component: list + create form + table |
| `app/(dashboard)/domains/actions.ts` | Server actions: `createDomain` / `deleteDomain` / `renameDomain` |
| `components/domains/create-form.tsx` | Client form with inline-error banner |
| `components/domains/domain-row.tsx` | Client row with inline rename (Pencil → input, ENTER/ESC) |
| `components/domains/delete-dialog.tsx` | Client native `<dialog>` confirm with wipe-webroot checkbox |
| `components/app-shell/sidebar.tsx` | MODIFY: flip `Domains` NAV item to `enabled: true` |

---

## Task N1: DB migration — add `updatedAt`

**Files:**
- Modify: `db/schema.ts:11-19` (the `domains` table block)

- [ ] **Step 1: Modify the `domains` table** to add the `updatedAt` column.

Replace the existing `domains` block with:
```ts
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  domain: text("domain").notNull().unique(),
  rootPath: text("root_path").notNull(),
  sslEnabled: integer("ssl_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type Domain = typeof domains.$inferSelect;
```
(The `Domain` type export is also new — used by other tasks.)

- [ ] **Step 2: Push the migration**

Run: `npm run db:push`
Expected: drizzle-kit adds the `updated_at` column non-interactively. If it prompts for a default value (the column is NOT NULL with a runtime default), accept "yes / use default" or supply `(unixepoch())`.

- [ ] **Step 3: Verify the column exists**

Run:
```bash
node -e "const D=require('better-sqlite3');const db=new D('panel.db');console.log(db.prepare('pragma table_info(domains)').all().map(c=>c.name))"
```
Expected: list includes `updated_at`.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts
git commit -m "feat(slice-n): add updatedAt to domains schema"
```

---

## Task N2: `validateDomain` (TDD)

**Files:**
- Create: `lib/nginx/validate.ts`
- Test: `lib/nginx/validate.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/nginx/validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateDomain } from "./validate";

const ok = (d: string) => expect(validateDomain(d).ok).toBe(true);
const bad = (d: string, reasonMatches?: RegExp) => {
  const r = validateDomain(d);
  expect(r.ok).toBe(false);
  if (!r.ok && reasonMatches) expect(r.reason).toMatch(reasonMatches);
};

describe("validateDomain", () => {
  it("accepts canonical hostnames", () => {
    ok("example.com");
    ok("sub.example.com");
    ok("a.b");
    ok("123-foo.example-site.co");
    ok("deep.sub.example.org");
  });

  it("rejects empty / non-string", () => {
    bad("", /required|empty/i);
  });

  it("rejects single-label (not FQDN)", () => {
    bad("example", /fqdn|labels/i);
  });

  it("rejects mixed-case", () => {
    bad("Example.com", /lowercase/i);
    bad("EXAMPLE.COM", /lowercase/i);
  });

  it("rejects forbidden characters", () => {
    bad("foo bar.com", /character/i);
    bad("foo/bar.com", /character/i);
    bad("foo_bar.com", /character/i);
    bad("foo$bar.com", /character/i);
  });

  it("rejects double-dot / leading or trailing dot", () => {
    bad("foo..com", /consecutive|label/i);
    bad(".foo.com", /label/i);
    bad("foo.com.", /label/i);
  });

  it("rejects bad label edges (hyphen at start or end)", () => {
    bad("-foo.com", /label/i);
    bad("foo-.com", /label/i);
  });

  it("rejects overly long labels and total length", () => {
    bad("a".repeat(64) + ".com", /label/i);
    bad("a".repeat(250) + ".co", /253|long/i);
  });

  it("rejects localhost and IPv4", () => {
    bad("localhost", /localhost/i);
    bad("192.168.1.1", /ip/i);
    bad("10.0.0.1", /ip/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/nginx/validate.test.ts`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 3: Implement**

`lib/nginx/validate.ts`:
```ts
export type ValidationResult = { ok: true } | { ok: false; reason: string };

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d+(\.\d+){3}$/;

export function validateDomain(input: unknown): ValidationResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "domain is required" };
  }
  if (input.length > 253) {
    return { ok: false, reason: "domain too long (max 253 chars)" };
  }
  if (input !== input.toLowerCase()) {
    return { ok: false, reason: "domain must be lowercase" };
  }
  if (!/^[a-z0-9.\-]+$/.test(input)) {
    return { ok: false, reason: "invalid character (only a-z, 0-9, '.' and '-' allowed)" };
  }
  if (input.includes("..")) {
    return { ok: false, reason: "consecutive dots are not allowed" };
  }
  if (input === "localhost") {
    return { ok: false, reason: "localhost is not allowed" };
  }
  if (IPV4.test(input)) {
    return { ok: false, reason: "ip addresses are not allowed" };
  }
  const labels = input.split(".");
  if (labels.length < 2) {
    return { ok: false, reason: "must be a fully-qualified domain (e.g. example.com)" };
  }
  for (const label of labels) {
    if (!LABEL.test(label)) {
      return { ok: false, reason: `invalid label: "${label}"` };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run to verify pass (9 tests)**

Run: `npx vitest run lib/nginx/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/nginx/validate.ts lib/nginx/validate.test.ts
git commit -m "feat(slice-n): add strict validateDomain (the security gate)"
```

---

## Task N3: `renderConfig` + `renderPlaceholderHtml` (TDD)

**Files:**
- Create: `lib/nginx/render.ts`, `lib/nginx/render.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/nginx/render.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderConfig, renderPlaceholderHtml } from "./render";

describe("renderConfig", () => {
  it("renders an nginx server block with the supplied domain", () => {
    const c = renderConfig("example.com");
    expect(c).toContain("server_name example.com;");
    expect(c).toContain("root /var/www/example.com/public_html;");
    expect(c).toContain("listen 80;");
    expect(c).toContain("try_files $uri $uri/ =404;");
    expect(c).toContain("access_log /var/log/nginx/example.com.access.log;");
    expect(c).toContain("error_log /var/log/nginx/example.com.error.log;");
    expect(c).toMatch(/^# Generated by rinpanel for example\.com\n/);
    expect(c.endsWith("\n")).toBe(true);
  });

  it("substitutes a different domain consistently", () => {
    const c = renderConfig("foo.bar.co");
    expect(c).toContain("server_name foo.bar.co;");
    expect(c).toContain("root /var/www/foo.bar.co/public_html;");
    expect(c).not.toContain("example.com");
  });
});

describe("renderPlaceholderHtml", () => {
  it("returns html containing the domain", () => {
    const h = renderPlaceholderHtml("example.com");
    expect(h.toLowerCase()).toContain("<!doctype html>");
    expect(h).toContain("example.com");
    expect(h.toUpperCase()).toContain("PROVISIONED");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/nginx/render.test.ts`
Expected: FAIL — cannot find module `./render`.

- [ ] **Step 3: Implement**

`lib/nginx/render.ts`:
```ts
export function renderConfig(domain: string): string {
  return `# Generated by rinpanel for ${domain}
server {
    listen 80;
    server_name ${domain};
    root /var/www/${domain}/public_html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    access_log /var/log/nginx/${domain}.access.log;
    error_log /var/log/nginx/${domain}.error.log;
}
`;
}

export function renderPlaceholderHtml(domain: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${domain} · provisioned</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0a0a0a; color: #e4e4e7; }
  .card { padding: 2rem 2.5rem; border: 1px solid rgba(255,255,255,0.09);
          border-radius: 0.75rem; background: rgba(20,22,26,0.7); }
  .eyebrow { color: #84cc16; font-size: 0.65rem; letter-spacing: 0.22em;
             text-transform: uppercase; }
  h1 { font-size: 1.5rem; margin: 0.6rem 0 0 0; }
  p { margin: 0.4rem 0 0 0; color: #71717a; font-size: 0.85rem; }
</style>
</head>
<body>
  <div class="card">
    <p class="eyebrow">▸ rinpanel · provisioned</p>
    <h1>${domain}</h1>
    <p>vhost is live. upload your site files via the file manager (coming soon).</p>
  </div>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/nginx/render.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/nginx/render.ts lib/nginx/render.test.ts
git commit -m "feat(slice-n): add nginx config + placeholder HTML renderers"
```

---

## Task N4: `writeFileOnTarget` helper

**Files:**
- Create: `lib/system/target-fs.ts`, `lib/system/target-fs.test.ts`

- [ ] **Step 1: Write the test**

`lib/system/target-fs.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileOnTarget } from "./target-fs";

describe("writeFileOnTarget — host path (USE_DOCKER=false)", () => {
  let dir: string;
  let savedFlag: string | undefined;

  beforeEach(async () => {
    savedFlag = process.env.USE_DOCKER;
    process.env.USE_DOCKER = "false";
    dir = await mkdtemp(join(tmpdir(), "rinpanel-tfs-"));
  });

  afterEach(async () => {
    if (savedFlag === undefined) delete process.env.USE_DOCKER;
    else process.env.USE_DOCKER = savedFlag;
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the file directly to the host path", async () => {
    const target = join(dir, "out.txt");
    await writeFileOnTarget(target, "hello world");
    expect(await readFile(target, "utf8")).toBe("hello world");
  });

  it("overwrites an existing file", async () => {
    const target = join(dir, "out.txt");
    await writeFile(target, "old");
    await writeFileOnTarget(target, "new");
    expect(await readFile(target, "utf8")).toBe("new");
  });
});
```

> Dev-mode (`USE_DOCKER=true`, docker cp) is exercised by the `vhost.ts` integration tests in N5 against the running container.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/system/target-fs.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`lib/system/target-fs.ts`:
```ts
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

function useDocker(): boolean {
  return process.env.USE_DOCKER === "true";
}

function containerName(): string {
  return process.env.CONTAINER_NAME ?? "panel-server";
}

function dockerCp(src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", ["cp", src, dst], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (c) => { stderr += c.toString(); });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`docker cp exit ${code}: ${stderr.trim()}`)),
    );
  });
}

/**
 * Write a file to the *target* — the dev container (USE_DOCKER=true)
 * or the host (prod). Uses `docker cp` for the dev path so the file
 * lands at the literal `targetPath` inside the container, with no
 * shell interpolation of the content.
 */
export async function writeFileOnTarget(targetPath: string, content: string): Promise<void> {
  if (useDocker()) {
    const tmp = join(tmpdir(), `rinpanel-${randomBytes(8).toString("hex")}`);
    await writeFile(tmp, content);
    try {
      await dockerCp(tmp, `${containerName()}:${targetPath}`);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  } else {
    await writeFile(targetPath, content);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/system/target-fs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/system/target-fs.ts lib/system/target-fs.test.ts
git commit -m "feat(slice-n): add writeFileOnTarget (USE_DOCKER-aware file write)"
```

---

## Task N5: `vhost.ts` (apply/remove/rename) + container integration test

**Files:**
- Create: `lib/nginx/vhost.ts`, `lib/nginx/vhost.test.ts`

- [ ] **Step 1: Implement the service**

`lib/nginx/vhost.ts`:
```ts
import { runOnTarget } from "@/lib/shell";
import { writeFileOnTarget } from "@/lib/system/target-fs";
import { renderConfig, renderPlaceholderHtml } from "./render";

export type VhostResult = { ok: true } | { ok: false; error: string };

const SITES_AVAILABLE = (d: string) => `/etc/nginx/sites-available/${d}.conf`;
const SITES_ENABLED = (d: string) => `/etc/nginx/sites-enabled/${d}`;
const WWW_ROOT = (d: string) => `/var/www/${d}`;
const WEB_ROOT = (d: string) => `/var/www/${d}/public_html`;
const INDEX_HTML = (d: string) => `${WEB_ROOT(d)}/index.html`;

async function nginxTest(): Promise<{ ok: boolean; stderr: string }> {
  const r = await runOnTarget(["nginx", "-t"]);
  return { ok: r.success, stderr: r.stderr };
}

async function nginxReload(): Promise<void> {
  await runOnTarget(["nginx", "-s", "reload"]);
}

export async function applyVhost(domain: string): Promise<VhostResult> {
  await writeFileOnTarget(SITES_AVAILABLE(domain), renderConfig(domain));
  await runOnTarget(["mkdir", "-p", WEB_ROOT(domain)]);
  await writeFileOnTarget(INDEX_HTML(domain), renderPlaceholderHtml(domain));
  await runOnTarget(["ln", "-sf", SITES_AVAILABLE(domain), SITES_ENABLED(domain)]);

  const t = await nginxTest();
  if (!t.ok) {
    // Rollback: remove symlink + conf only; leave webroot in place (benign without active vhost)
    await runOnTarget(["rm", "-f", SITES_ENABLED(domain)]);
    await runOnTarget(["rm", "-f", SITES_AVAILABLE(domain)]);
    return { ok: false, error: t.stderr };
  }
  await nginxReload();
  return { ok: true };
}

export async function removeVhost(
  domain: string,
  opts: { wipeWebroot?: boolean } = {},
): Promise<VhostResult> {
  await runOnTarget(["rm", "-f", SITES_ENABLED(domain)]);
  await runOnTarget(["rm", "-f", SITES_AVAILABLE(domain)]);
  if (opts.wipeWebroot) {
    await runOnTarget(["rm", "-rf", WWW_ROOT(domain)]);
  }
  const t = await nginxTest();
  if (!t.ok) return { ok: false, error: t.stderr };
  await nginxReload();
  return { ok: true };
}

export async function renameVhost(oldDomain: string, newDomain: string): Promise<VhostResult> {
  if (oldDomain === newDomain) return { ok: true };

  await runOnTarget(["mv", WWW_ROOT(oldDomain), WWW_ROOT(newDomain)]);
  await writeFileOnTarget(SITES_AVAILABLE(newDomain), renderConfig(newDomain));
  await runOnTarget(["ln", "-sf", SITES_AVAILABLE(newDomain), SITES_ENABLED(newDomain)]);

  const t = await nginxTest();
  if (!t.ok) {
    // Rollback
    await runOnTarget(["rm", "-f", SITES_ENABLED(newDomain)]);
    await runOnTarget(["rm", "-f", SITES_AVAILABLE(newDomain)]);
    await runOnTarget(["mv", WWW_ROOT(newDomain), WWW_ROOT(oldDomain)]);
    return { ok: false, error: t.stderr };
  }

  await runOnTarget(["rm", "-f", SITES_ENABLED(oldDomain)]);
  await runOnTarget(["rm", "-f", SITES_AVAILABLE(oldDomain)]);
  await nginxReload();
  return { ok: true };
}
```

- [ ] **Step 2: Write the container integration test**

`lib/nginx/vhost.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCommand, runOnTarget } from "@/lib/shell";
import { applyVhost, removeVhost, renameVhost } from "./vhost";

const TEST = "rinpanel-int-test.localdomain";
const TEST_RENAMED = "rinpanel-int-test-renamed.localdomain";

async function dockerUp(): Promise<boolean> {
  const r = await runCommand(["docker", "info"]);
  return r.success;
}

async function curlInContainer(host: string): Promise<{ status: number; body: string }> {
  // -s silent, -o write body to /dev/stdout, -w show status code at end
  const r = await runOnTarget([
    "curl", "-s", "-o", "/tmp/_curl_body", "-w", "%{http_code}",
    "-H", `Host: ${host}`,
    "http://127.0.0.1/",
  ]);
  const body = (await runOnTarget(["cat", "/tmp/_curl_body"])).stdout;
  return { status: Number(r.stdout.trim()), body };
}

let dockerReady = false;
beforeAll(async () => {
  dockerReady = (await dockerUp()) && process.env.USE_DOCKER === "true";
  if (!dockerReady) console.log("vhost.test: skipping — Docker not available / USE_DOCKER!=true");
  // Cleanup from prior runs
  if (dockerReady) {
    await removeVhost(TEST, { wipeWebroot: true });
    await removeVhost(TEST_RENAMED, { wipeWebroot: true });
  }
}, 30_000);

afterAll(async () => {
  if (dockerReady) {
    await removeVhost(TEST, { wipeWebroot: true });
    await removeVhost(TEST_RENAMED, { wipeWebroot: true });
  }
}, 30_000);

describe("vhost integration (container)", () => {
  it("applies a vhost and serves the placeholder", async () => {
    if (!dockerReady) return;
    const r = await applyVhost(TEST);
    expect(r.ok).toBe(true);
    const got = await curlInContainer(TEST);
    expect(got.status).toBe(200);
    expect(got.body.toUpperCase()).toContain("PROVISIONED");
  }, 30_000);

  it("renames a vhost — old name 404s, new name serves", async () => {
    if (!dockerReady) return;
    const r = await renameVhost(TEST, TEST_RENAMED);
    expect(r.ok).toBe(true);
    expect((await curlInContainer(TEST_RENAMED)).status).toBe(200);
    // After rename, old domain has no enabled vhost — nginx returns the default_server's 200 or 404,
    // depending on whether the default_server matches `_`. Our default conf does match `_`, so the
    // old hostname falls through to the default. Assert: it's NOT serving the placeholder anymore.
    const old = await curlInContainer(TEST);
    expect(old.body.toUpperCase()).not.toContain("PROVISIONED");
  }, 30_000);

  it("removes a vhost — domain stops serving", async () => {
    if (!dockerReady) return;
    const r = await removeVhost(TEST_RENAMED, { wipeWebroot: true });
    expect(r.ok).toBe(true);
    const got = await curlInContainer(TEST_RENAMED);
    expect(got.body.toUpperCase()).not.toContain("PROVISIONED");
  }, 30_000);
});
```

- [ ] **Step 3: Verify tests pass against the running container**

Start the container if it isn't running:
```bash
docker compose up -d
```
Then:
```bash
USE_DOCKER=true CONTAINER_NAME=panel-server npx vitest run lib/nginx/vhost.test.ts
```
Expected: 3 tests pass. If Docker isn't available, all three early-return as no-ops (test still passes).

- [ ] **Step 4: Verify the full suite is still green**

Run: `npm test`
Expected: 20 baseline + 9 (validate) + 3 (render) + 2 (target-fs) + 3 (vhost) = 37 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/nginx/vhost.ts lib/nginx/vhost.test.ts
git commit -m "feat(slice-n): add vhost service (apply/remove/rename) with rollback"
```

---

## Task N6: Server actions

**Files:**
- Create: `app/(dashboard)/domains/actions.ts`

- [ ] **Step 1: Create the file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { validateDomain } from "@/lib/nginx/validate";
import { applyVhost, removeVhost, renameVhost } from "@/lib/nginx/vhost";
import { logActivity } from "@/lib/system/activity";

async function requireSession(): Promise<void> {
  const s = await auth();
  if (!s) redirect("/login");
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createDomain(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const raw = String(formData.get("domain") ?? "").trim();
  const v = validateDomain(raw);
  if (!v.ok) return { ok: false, error: v.reason };

  const existing = db.select().from(domains).where(eq(domains.domain, raw)).get();
  if (existing) return { ok: false, error: "domain already exists" };

  const r = await applyVhost(raw);
  if (!r.ok) return { ok: false, error: r.error };

  db.insert(domains).values({
    domain: raw,
    rootPath: `/var/www/${raw}/public_html`,
  }).run();
  logActivity("domain_create", raw);

  revalidatePath("/domains");
  return { ok: true };
}

export async function deleteDomain(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const wipe = formData.get("wipeWebroot") === "on";

  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  const r = await removeVhost(row.domain, { wipeWebroot: wipe });
  if (!r.ok) return { ok: false, error: r.error };

  db.delete(domains).where(eq(domains.id, id)).run();
  logActivity("domain_delete", wipe ? `${row.domain} (wiped webroot)` : row.domain);

  revalidatePath("/domains");
  return { ok: true };
}

export async function renameDomain(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("domain") ?? "").trim();

  const v = validateDomain(next);
  if (!v.ok) return { ok: false, error: v.reason };

  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };
  if (row.domain === next) return { ok: true };

  const dup = db.select().from(domains).where(eq(domains.domain, next)).get();
  if (dup) return { ok: false, error: "domain already exists" };

  const r = await renameVhost(row.domain, next);
  if (!r.ok) return { ok: false, error: r.error };

  db.update(domains)
    .set({ domain: next, rootPath: `/var/www/${next}/public_html`, updatedAt: new Date() })
    .where(eq(domains.id, id))
    .run();
  logActivity("domain_rename", `${row.domain} → ${next}`);

  revalidatePath("/domains");
  return { ok: true };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/domains/actions.ts"
git commit -m "feat(slice-n): add server actions for create/delete/rename domain"
```

---

## Task N7: Domains page (server component list) + sidebar enable

**Files:**
- Create: `app/(dashboard)/domains/page.tsx`
- Modify: `components/app-shell/sidebar.tsx` (the `NAV` array, flip `enabled` for the Domains item)

- [ ] **Step 1: Create the page**

`app/(dashboard)/domains/page.tsx`:
```tsx
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { domains } from "@/db/schema";
import { CreateForm } from "@/components/domains/create-form";
import { DomainRow } from "@/components/domains/domain-row";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const rows = db.select().from(domains).orderBy(desc(domains.createdAt)).all();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">module 02 · domains</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">vhosts</h1>
        </div>
        <span className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 font-mono text-[0.65rem] tracking-wide uppercase text-lime-300">
          {rows.length} active
        </span>
      </header>

      <CreateForm />

      {rows.length === 0 ? (
        <div className="glass corner-ticks relative rounded-xl p-8 text-center">
          <p className="eyebrow">no domains configured</p>
          <p className="mt-2 font-mono text-sm text-zinc-500">tambahin domain pertama lewat form di atas</p>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-xl">
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 px-5 py-3">
            <span className="eyebrow">domain</span>
            <span className="eyebrow">actions</span>
          </div>
          <ul className="divide-y divide-white/5">
            {rows.map((r) => (
              <DomainRow key={r.id} row={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Enable the sidebar Domains item**

Modify `components/app-shell/sidebar.tsx` — in the `NAV` array, change the `Domains` entry's `enabled: false` to `enabled: true`. No other changes.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: route table now lists `/domains` (dynamic).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/domains/page.tsx" components/app-shell/sidebar.tsx
git commit -m "feat(slice-n): add domains page + enable sidebar nav item"
```

---

## Task N8: `CreateForm` (client component)

**Files:**
- Create: `components/domains/create-form.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useActionState, useRef, useEffect } from "react";
import { createDomain, type ActionResult } from "@/app/(dashboard)/domains/actions";

export function CreateForm() {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    createDomain,
    undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on success
  useEffect(() => {
    if (state?.ok) inputRef.current?.form?.reset();
  }, [state]);

  return (
    <form action={formAction} className="glass corner-ticks relative flex flex-col gap-3 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">add vhost</span>
        <span className="font-mono text-[0.6rem] tracking-wider text-zinc-600 uppercase">static · port 80</span>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="eyebrow">domain</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">
              ▸
            </span>
            <input
              ref={inputRef}
              name="domain"
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(e) => {
                // display-only auto-lowercase
                const v = e.currentTarget.value;
                if (v !== v.toLowerCase()) e.currentTarget.value = v.toLowerCase();
              }}
              className="h-11 w-full rounded-md border border-white/[0.08] bg-black/40 pr-3 pl-8 font-mono text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-lime-500/50 focus:bg-black/60 focus:ring-2 focus:ring-lime-500/20"
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="accent-glow mt-2 flex h-11 items-center justify-center gap-2 self-end rounded-md bg-primary px-5 font-mono text-sm font-bold tracking-wide text-primary-foreground uppercase transition disabled:opacity-60 md:mt-[1.45rem]"
        >
          {pending ? (
            <>
              <span className="animate-blink">[ ·· ]</span>
              <span>provisioning</span>
            </>
          ) : (
            <>
              <span>+ add domain</span>
              <span className="text-primary-foreground/60">↵</span>
            </>
          )}
        </button>
      </div>

      {state && !state.ok && state.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <div className="flex items-center gap-2 font-mono text-xs text-red-300">
            <span className="size-1.5 shrink-0 rounded-full bg-red-400 animate-glow-pulse" />
            failed: {state.error.split("\n")[0]}
          </div>
          {state.error.includes("\n") && (
            <pre className="mt-2 max-h-40 overflow-auto rounded border border-white/5 bg-black/40 p-2 font-mono text-[0.7rem] text-red-200/80">{state.error}</pre>
          )}
        </div>
      )}

      {state?.ok && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 animate-glow-pulse" />
          domain provisioned successfully
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/domains/create-form.tsx
git commit -m "feat(slice-n): add CreateForm client component with inline error banner"
```

---

## Task N9: `DomainRow` + `DeleteDialog` (client)

**Files:**
- Create: `components/domains/delete-dialog.tsx`
- Create: `components/domains/domain-row.tsx`

- [ ] **Step 1: Create `delete-dialog.tsx`**

```tsx
"use client";

import { useRef, useImperativeHandle, forwardRef } from "react";
import { deleteDomain } from "@/app/(dashboard)/domains/actions";

export interface DeleteDialogHandle {
  open: () => void;
  close: () => void;
}

interface Props {
  id: string;
  domain: string;
}

export const DeleteDialog = forwardRef<DeleteDialogHandle, Props>(function DeleteDialog({ id, domain }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.showModal(),
    close: () => dialogRef.current?.close(),
  }));

  return (
    <dialog
      ref={dialogRef}
      className="glass corner-ticks relative m-auto rounded-xl p-0 text-zinc-200 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal"
    >
      <form action={deleteDomain} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="id" value={id} />
        <div>
          <p className="eyebrow">vhost · delete</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">delete vhost?</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">domain · </span>
            <span className="text-zinc-200">{domain}</span>
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-black/30 p-3">
          <input
            type="checkbox"
            name="wipeWebroot"
            className="mt-0.5 size-4 shrink-0 accent-red-500"
          />
          <span className="flex flex-col gap-1">
            <span className="font-mono text-xs text-zinc-200">Hapus webroot juga?</span>
            <span className="font-mono text-[0.65rem] text-zinc-500">
              <code>/var/www/{domain}</code> — file di-wipe permanen
            </span>
          </span>
        </label>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-10 flex-1 rounded-md border border-red-500/40 bg-red-500/10 font-mono text-xs font-semibold tracking-wide uppercase text-red-300 hover:border-red-500/60 hover:bg-red-500/20"
          >
            Delete
          </button>
        </div>
      </form>
    </dialog>
  );
});
```

- [ ] **Step 2: Create `domain-row.tsx`**

```tsx
"use client";

import { useRef, useState, useActionState, useEffect } from "react";
import { Pencil, Trash, Check, X } from "lucide-react";
import { renameDomain, type ActionResult } from "@/app/(dashboard)/domains/actions";
import type { Domain } from "@/db/schema";
import { DeleteDialog, type DeleteDialogHandle } from "./delete-dialog";

interface Props {
  row: Domain;
}

export function DomainRow({ row }: Props) {
  const [editing, setEditing] = useState(false);
  const dialogRef = useRef<DeleteDialogHandle>(null);
  const [renameState, renameAction, renamePending] = useActionState<ActionResult | undefined, FormData>(
    renameDomain,
    undefined,
  );

  // Exit edit mode on successful rename
  useEffect(() => {
    if (renameState?.ok) setEditing(false);
  }, [renameState]);

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 hover:bg-white/[0.02]">
      <div className="flex min-w-0 flex-col gap-1">
        {editing ? (
          <form action={renameAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={row.id} />
            <div className="relative flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-lime-500/50">
                ▸
              </span>
              <input
                name="domain"
                defaultValue={row.domain}
                autoFocus
                spellCheck={false}
                required
                onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
                className="h-9 w-full rounded-md border border-white/[0.08] bg-black/40 pr-3 pl-8 font-mono text-sm text-white outline-none focus:border-lime-500/50 focus:ring-2 focus:ring-lime-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={renamePending}
              aria-label="Save rename"
              className="grid size-9 place-items-center rounded-md border border-lime-500/40 bg-lime-500/10 text-lime-300 hover:bg-lime-500/20"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Cancel rename"
              className="grid size-9 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm text-white">{row.domain}</span>
              <span className="rounded-sm border border-lime-500/30 bg-lime-500/10 px-1.5 py-0.5 font-mono text-[0.55rem] tracking-wider text-lime-300 uppercase">
                static
              </span>
            </div>
            <span className="truncate font-mono text-[0.7rem] text-zinc-500">
              ▸ {row.rootPath}
            </span>
          </>
        )}

        {renameState && !renameState.ok && renameState.error && editing && (
          <span className="font-mono text-[0.7rem] text-red-300">▸ {renameState.error}</span>
        )}
      </div>

      {!editing && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Rename domain"
            className="grid size-9 place-items-center rounded-md border border-transparent text-zinc-500 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => dialogRef.current?.open()}
            aria-label="Delete domain"
            className="grid size-9 place-items-center rounded-md border border-transparent text-zinc-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash className="size-4" />
          </button>
        </div>
      )}

      <DeleteDialog ref={dialogRef} id={row.id} domain={row.domain} />
    </li>
  );
}
```

- [ ] **Step 3: Verify build and full suite**

Run: `npm run build && npm test`
Expected: clean build (`/domains` in route table), tests still 37 passing.

- [ ] **Step 4: Commit**

```bash
git add components/domains/delete-dialog.tsx components/domains/domain-row.tsx
git commit -m "feat(slice-n): add DomainRow with inline rename + DeleteDialog"
```

---

## Task N10: Live QA + merge

- [ ] **Step 1: Boot dependencies**

```bash
docker compose up -d
npm run dev &
```
Wait for the server to be ready (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` returns 200).

- [ ] **Step 2: Run the live QA script**

Use the Playwright pattern from the polish slice (read creds from `.env.local`, login, then exercise the new flow). The QA must verify:
1. Navigate to `/domains` after login.
2. Add domain `qa-vhost.localdomain` — confirm row appears.
3. From inside the dev container, `curl -H "Host: qa-vhost.localdomain" http://127.0.0.1/` returns 200 with the placeholder.
4. Click the pencil → edit to `qa-vhost-renamed.localdomain` → ENTER → row updates.
5. Curl the new domain → 200 with placeholder; curl the old name does NOT serve the placeholder.
6. Click trash → dialog opens → Cancel closes it.
7. Re-open → check the wipe-webroot checkbox → Delete → row disappears.
8. Curl the deleted domain → no placeholder (default_server response).
9. Screenshots at desktop (1280) and mobile (390) for the populated `/domains` page and the open delete dialog.

Save screenshots as `qa-domains-*.png` (already in `.gitignore` via `qa-*.png`). Verify them visually — PHOSPHOR styling must be consistent with `/` and `/login`.

- [ ] **Step 3: Verify the audit log**

Run:
```bash
node -e "const D=require('better-sqlite3');const db=new D('panel.db');console.log(db.prepare(\"select action, detail from activity_logs order by created_at desc limit 6\").all())"
```
Expected: most recent rows include `domain_delete`, `domain_rename`, `domain_create`.

- [ ] **Step 4: Stop the dev server, full test + build sanity**

```bash
kill %1 2>/dev/null; pkill -f "next dev" 2>/dev/null
npm test
npm run build
```
Expected: 37 passing, build clean.

- [ ] **Step 5: Merge & push**

```bash
git checkout main
git merge --no-ff slice-n-domains-nginx -m "merge: slice N — Domains & Nginx (static vhosts CRUD)"
npm test
git branch -d slice-n-domains-nginx
git push origin main
```

---

## Self-review

- **Spec coverage:** schema migration (N1), validation gate (N2), config + placeholder rendering (N3), file-write seam (N4), vhost service with rollback + integration tests (N5), server actions with auth + audit (N6), domains page + sidebar enable (N7), create form (N8), row + dialog with inline rename + wipe checkbox (N9), live QA (N10). All §3 in-scope items and §13 acceptance criteria map to tasks.
- **Placeholder scan:** none. `<domain>` inside the nginx template is intentional substitution syntax.
- **Type consistency:** `validateDomain` / `ValidationResult` / `renderConfig` / `renderPlaceholderHtml` / `writeFileOnTarget` / `applyVhost` / `removeVhost` / `renameVhost` / `VhostResult` / `Domain` type / `createDomain` / `deleteDomain` / `renameDomain` / `ActionResult` / `CreateForm` / `DomainRow` / `DeleteDialog` / `DeleteDialogHandle` — names consistent across tasks.
- **UI consistency contract** (`docs/superpowers/specs/2026-06-13-domains-nginx-design.md` §4) is enforced in N7/N8/N9: PHOSPHOR hero with MODULE 02 eyebrow, glass cards, ▸ caret inputs, native `<dialog>` confirm matching the logout pattern, semantic ramp for banners, mobile verification in N10.
