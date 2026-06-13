# rinpanel Slice 1: Foundation + Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first vertical slice of rinpanel — a single-admin login guarding a live PHOSPHOR dashboard that reads CPU/RAM/disk/load/uptime from a Docker Linux box through a safe shell-execution seam.

**Architecture:** Next.js App Router (Node runtime) with NextAuth v5 split-config auth (edge-safe `auth.config.ts` for middleware + Node `auth.ts` for Credentials). UI never calls `exec` directly: dashboard → `/api/system/metrics` → `getMetrics()` → pure parsers + `lib/shell.ts` (argv arrays, `USE_DOCKER` toggle) → `docker exec panel-server …`. Drizzle + better-sqlite3 for persistence. Telemetry is polled (~3s); the metrics route returns partial data with an `errors[]` array rather than failing whole.

**Tech Stack:** Next.js (latest, App Router, TS, Tailwind v4), NextAuth v5 (`next-auth@beta`), Drizzle ORM + better-sqlite3, bcryptjs, zod, lucide-react, Vitest (unit/integration), Python Playwright (visual QA), Docker (Ubuntu + Nginx + Certbot).

**Source of truth:** `docs/superpowers/specs/2026-06-13-foundation-dashboard-design.md`. Design system: `design.md` (PHOSPHOR). Build guide: `init.md`.

**Implementation note — shadcn:** The spec lists "shadcn (Base UI variant)". To keep this plan executable without interactive `shadcn init` prompts, this slice hand-rolls the 2–3 primitives it needs (glass card, button, input) using PHOSPHOR utility classes directly — the visual identity comes from PHOSPHOR, not shadcn defaults. shadcn can be layered in a later slice when component complexity warrants. This is the only deliberate deviation from the spec.

---

## File Structure

**Created by scaffold (Task 1):** `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`, `public/*`.

**Created/modified by this plan:**

| File | Responsibility |
|---|---|
| `vitest.config.ts` | Vitest config + `@` path alias |
| `.env.local`, `.env.example` | secrets + dev toggles |
| `docker/Dockerfile`, `docker/nginx-default.conf`, `docker-compose.yml` | the `panel-server` Linux box |
| `app/globals.css` (rewrite) | PHOSPHOR tokens, background layers, utilities, keyframes |
| `app/layout.tsx` (rewrite) | three fonts + `html.dark` |
| `lib/auth/password.ts` (+ `.test.ts`) | `hashPassword` / `verifyPassword` (bcryptjs) |
| `lib/shell.ts` (+ `.test.ts`) | `runCommand` / `runInContainer` / `runOnTarget` (argv, no shell) |
| `db/schema.ts`, `db/index.ts`, `db/seed.ts`, `drizzle.config.ts` | persistence + admin bootstrap |
| `lib/system/metrics.ts` (+ `.test.ts`) | pure parsers + `getMetrics()` gatherer |
| `lib/system/activity.ts` | `logActivity` / `getRecentActivity` |
| `auth.config.ts`, `auth.ts`, `middleware.ts`, `app/api/auth/[...nextauth]/route.ts` | NextAuth v5 split config + route protection |
| `app/(auth)/login/page.tsx`, `app/(auth)/login/actions.ts` | login form + server action |
| `app/api/system/metrics/route.ts` (+ `.test.ts`) | session-gated metrics endpoint |
| `app/(dashboard)/layout.tsx`, `components/app-shell/sidebar.tsx` | PHOSPHOR app shell |
| `lib/hooks/use-polling.ts` | client polling hook |
| `components/dashboard/{stat-tile,status-dot,usage-bar,activity-log,live-dashboard}.tsx` | dashboard UI |
| `app/(dashboard)/page.tsx` | dashboard page wiring |
| `scripts/visual-qa.py` | Playwright login + screenshot |

---

## Task 1: Scaffold Next.js around existing files

**Files:** Creates the Next.js app in the repo root without clobbering `CLAUDE.md` / `design.md` / `init.md` / `docs/` / `.git`.

- [ ] **Step 1: Scaffold into a temp sibling dir** (avoids `create-next-app`'s non-empty-dir refusal)

Run:
```bash
cd /Users/nath/projects
npx create-next-app@latest rinpanel-tmp --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --yes
```
Expected: scaffold completes in `/Users/nath/projects/rinpanel-tmp` (Tailwind v4, Next.js latest).

- [ ] **Step 2: Merge generated files into the repo, drop temp git**

Run:
```bash
rm -rf rinpanel-tmp/.git
cp -R rinpanel-tmp/. rinpanel/
rm -rf rinpanel-tmp
cd rinpanel
```
Expected: `package.json`, `app/`, `tsconfig.json`, `next.config.ts`, `.gitignore` now exist in `rinpanel/`; the three `.md` files and `docs/` are untouched.

- [ ] **Step 3: Verify it boots and lints**

Run: `npm run build`
Expected: build succeeds (default Next.js starter page compiles).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app (App Router, TS, Tailwind v4)"
```

---

## Task 2: Install dependencies, Vitest, and scripts

**Files:** Modify `package.json`; Create `vitest.config.ts`.

- [ ] **Step 1: Install runtime + dev dependencies**

Run:
```bash
npm install drizzle-orm better-sqlite3 next-auth@beta bcryptjs zod lucide-react clsx tailwind-merge
npm install -D drizzle-kit @types/better-sqlite3 @types/bcryptjs vitest tsx dotenv
```
Expected: installs succeed; `next-auth@beta` resolves to a v5 (`5.x`) version.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 3: Add scripts to `package.json`**

In the `"scripts"` object, add these keys (keep the existing `dev`/`build`/`start`/`lint`):
```json
    "test": "vitest run",
    "test:watch": "vitest",
    "db:push": "drizzle-kit push",
    "db:seed": "tsx db/seed.ts"
```

- [ ] **Step 4: Verify Vitest runs (no tests yet)**

Run: `npm test`
Expected: Vitest reports "No test files found" and exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add deps, Vitest, and db/test scripts"
```

---

## Task 3: Environment config

**Files:** Create `.env.local`, `.env.example`; Modify `.gitignore`.

- [ ] **Step 1: Create `.env.example`**

```
AUTH_SECRET=replace-with-output-of-openssl-rand-base64-32
USE_DOCKER=true
CONTAINER_NAME=panel-server
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-strong
```

- [ ] **Step 2: Create `.env.local` with a real secret**

Run:
```bash
SECRET=$(openssl rand -base64 32)
cat > .env.local <<EOF
AUTH_SECRET=$SECRET
USE_DOCKER=true
CONTAINER_NAME=panel-server
ADMIN_USERNAME=admin
ADMIN_PASSWORD=panel-admin-$(openssl rand -hex 4)
EOF
cat .env.local
```
Expected: `.env.local` prints with a populated `AUTH_SECRET` and `ADMIN_PASSWORD`. **Note the `ADMIN_USERNAME`/`ADMIN_PASSWORD` — they are your login.**

- [ ] **Step 3: Ensure DB + env are git-ignored**

Append to `.gitignore` (Next's default already ignores `.env*`; add the DB):
```
# rinpanel
panel.db
panel.db-*
```

- [ ] **Step 4: Commit** (`.env.local` is ignored and will NOT be staged — verify)

```bash
git add .env.example .gitignore
git status --short   # confirm .env.local is NOT listed
git commit -m "chore: add env example and ignore local db/secrets"
```

---

## Task 4: Docker `panel-server` box

**Files:** Create `docker/Dockerfile`, `docker/nginx-default.conf`, `docker-compose.yml`.

- [ ] **Step 1: Create `docker/Dockerfile`**

```dockerfile
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    nginx \
    certbot \
    python3-certbot-nginx \
    curl \
    openssh-server \
    sudo \
    procps \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /var/run/sshd \
    && echo 'root:panel123' | chpasswd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

RUN mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
COPY nginx-default.conf /etc/nginx/sites-available/default

EXPOSE 22 80 443
CMD service ssh start && nginx -g 'daemon off;'
```
> `procps` is added (over `init.md`) so `free`/`uptime` exist in the container. SSH/root password are dev-only.

- [ ] **Step 2: Create `docker/nginx-default.conf`**

```nginx
server {
    listen 80 default_server;
    server_name _;
    root /var/www/html;
    index index.html;
}
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  server:
    build: ./docker
    container_name: panel-server
    ports:
      - "2222:22"
      - "8080:80"
      - "8443:443"
    volumes:
      - ./server-data/www:/var/www
      - ./server-data/nginx:/etc/nginx/sites-available
    restart: unless-stopped
```

- [ ] **Step 4: Build and start the container**

Run: `docker compose up -d --build`
Expected: image builds; `panel-server` container starts.

- [ ] **Step 5: Verify telemetry commands work inside it**

Run: `docker exec panel-server bash -c "free -m | head -2 && cat /proc/loadavg && hostname"`
Expected: a `Mem:` line, a loadavg line, and the hostname print.

- [ ] **Step 6: Commit**

```bash
git add docker docker-compose.yml
echo "server-data/" >> .gitignore
git add .gitignore
git commit -m "feat: add panel-server Docker box (Ubuntu/Nginx/Certbot)"
```

---

## Task 5: PHOSPHOR globals + fonts

**Files:** Rewrite `app/globals.css`, `app/layout.tsx`.

- [ ] **Step 1: Rewrite `app/globals.css`** (replace entire file)

```css
@import "tailwindcss";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-popover: var(--popover);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius: var(--radius);
  --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-display: var(--font-chakra), var(--font-geist), ui-sans-serif, sans-serif;
}

:root {
  --accent-rgb: 132 204 22;
  --background: oklch(0.145 0.006 256);
  --foreground: oklch(0.93 0.004 247);
  --card: oklch(0.205 0.007 256);
  --popover: oklch(0.2 0.007 256);
  --primary: #84cc16;
  --primary-foreground: #0a0a0a;
  --secondary: oklch(0.27 0.007 256);
  --muted: oklch(0.27 0.007 256);
  --muted-foreground: oklch(0.682 0.012 250);
  --accent: oklch(0.3 0.008 256);
  --destructive: oklch(0.62 0.21 24);
  --border: oklch(1 0 0 / 9%);
  --input: oklch(1 0 0 / 12%);
  --ring: #84cc16;
  --radius: 0.5rem;
}

html { color-scheme: dark; }

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  background-image:
    radial-gradient(130% 100% at 50% -8%, rgb(var(--accent-rgb)/0.10) 0%, transparent 46%),
    radial-gradient(90% 70% at 100% 0%, oklch(0.7 0.13 205 / 0.06) 0%, transparent 42%);
  background-attachment: fixed;
  min-height: 100vh;
}

body::before {
  content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, color-mix(in oklch, var(--foreground) 4%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 4%, transparent) 1px, transparent 1px);
  background-size: 46px 46px;
  -webkit-mask-image: radial-gradient(125% 100% at 50% 0%, black 0%, transparent 72%);
  mask-image: radial-gradient(125% 100% at 50% 0%, black 0%, transparent 72%);
}

::selection { background: rgb(var(--accent-rgb) / 0.3); }

@layer components {
  .eyebrow {
    font-family: var(--font-geist-mono), ui-monospace, monospace;
    font-size: 0.625rem; line-height: 1; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--muted-foreground);
  }
  .glass {
    background: color-mix(in oklch, var(--card) 70%, transparent);
    -webkit-backdrop-filter: blur(16px) saturate(1.35);
    backdrop-filter: blur(16px) saturate(1.35);
    border: 1px solid var(--border);
  }
  .text-glow { text-shadow: 0 0 18px rgb(var(--accent-rgb)/0.55), 0 0 4px rgb(var(--accent-rgb)/0.4); }
  .accent-glow { box-shadow: 0 0 0 1px rgb(var(--accent-rgb)/0.35), 0 8px 30px -10px rgb(var(--accent-rgb)/0.5); }
  .corner-ticks::before, .corner-ticks::after {
    content: ""; position: absolute; width: 10px; height: 10px;
    pointer-events: none; border-color: rgb(var(--accent-rgb)/0.5);
  }
  .corner-ticks::before { top: 10px; left: 10px; border-top: 1px solid; border-left: 1px solid; }
  .corner-ticks::after { bottom: 10px; right: 10px; border-bottom: 1px solid; border-right: 1px solid; }
  .scan-sweep { position: relative; overflow: hidden; }
  .scan-sweep::after {
    content: ""; position: absolute; inset-inline: 0; top: 0; height: 36%;
    background: linear-gradient(to bottom, transparent, rgb(var(--accent-rgb)/0.06), transparent);
    animation: scan-sweep 5s linear infinite; pointer-events: none;
  }
}

@keyframes reveal { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes scan-sweep { 0% { transform: translateY(-120%); } 100% { transform: translateY(420%); } }
@keyframes glow-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }

.animate-reveal { animation: reveal 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.animate-glow-pulse { animation: glow-pulse 2s ease-in-out infinite; }
.animate-blink { animation: blink 1s step-end infinite; }

@media (prefers-reduced-motion: reduce) {
  .animate-reveal, .animate-glow-pulse, .animate-blink { animation: none !important; }
  .scan-sweep::after { animation: none !important; }
}
```

- [ ] **Step 2: Rewrite `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono, Chakra_Petch } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const chakra = Chakra_Petch({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-chakra", display: "swap" });

export const metadata: Metadata = {
  title: "rinpanel",
  description: "Self-hosted hosting control panel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geist.variable} ${geistMono.variable} ${chakra.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Replace the starter `app/page.tsx`** with a temporary redirect to the dashboard (the `(dashboard)` group will own `/`, but until Task 16 keep a placeholder)

```tsx
export default function Home() {
  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center">
      <p className="eyebrow">rinpanel · booting</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds; fonts resolve.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx app/page.tsx
git commit -m "feat: wire PHOSPHOR design tokens, fonts, and background system"
```

---

## Task 6: Password utility (TDD)

**Files:** Create `lib/auth/password.ts`, `lib/auth/password.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/auth/password.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("verifies a correct password against its hash", () => {
    const hash = hashPassword("s3cret!");
    expect(verifyPassword("s3cret!", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("s3cret!");
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces different hashes for the same input (salted)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/auth/password.test.ts`
Expected: FAIL — cannot find module `./password`.

- [ ] **Step 3: Write minimal implementation**

`lib/auth/password.ts`:
```ts
import bcrypt from "bcryptjs";

const ROUNDS = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/auth/password.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/password.ts lib/auth/password.test.ts
git commit -m "feat: add bcryptjs password hash/verify utility"
```

---

## Task 7: Shell execution seam (TDD)

**Files:** Create `lib/shell.ts`, `lib/shell.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/shell.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runCommand } from "./shell";

describe("runCommand", () => {
  it("returns success and trimmed stdout for a valid command", async () => {
    const r = await runCommand(["echo", "hello"]);
    expect(r.success).toBe(true);
    expect(r.stdout).toBe("hello");
  });

  it("returns success=false for a failing command", async () => {
    const r = await runCommand(["false"]);
    expect(r.success).toBe(false);
  });

  it("does not invoke a shell (args are literal, not interpreted)", async () => {
    // If a shell ran, '$(whoami)' would expand. With execFile it is a literal arg.
    const r = await runCommand(["echo", "$(whoami)"]);
    expect(r.stdout).toBe("$(whoami)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/shell.test.ts`
Expected: FAIL — cannot find module `./shell`.

- [ ] **Step 3: Write minimal implementation**

`lib/shell.ts`:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ShellResult {
  stdout: string;
  stderr: string;
  success: boolean;
}

function containerName(): string {
  return process.env.CONTAINER_NAME ?? "panel-server";
}

function useDocker(): boolean {
  return process.env.USE_DOCKER === "true";
}

/** Execute argv directly on the host — NO shell, so args are never interpreted. */
export async function runCommand(argv: string[]): Promise<ShellResult> {
  const [cmd, ...args] = argv;
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.toString().trim(), stderr: stderr.toString().trim(), success: true };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: e.stdout?.toString().trim() ?? "",
      stderr: (e.stderr?.toString() || e.message || "command failed").trim(),
      success: false,
    };
  }
}

/** Run argv inside the dev container via `docker exec`. */
export async function runInContainer(argv: string[]): Promise<ShellResult> {
  return runCommand(["docker", "exec", containerName(), ...argv]);
}

/** The seam services call: container in dev (USE_DOCKER=true), host in prod. */
export async function runOnTarget(argv: string[]): Promise<ShellResult> {
  return useDocker() ? runInContainer(argv) : runCommand(argv);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/shell.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/shell.ts lib/shell.test.ts
git commit -m "feat: add shell execution seam (argv arrays, USE_DOCKER toggle)"
```

---

## Task 8: Database layer + seed

**Files:** Create `db/schema.ts`, `db/index.ts`, `drizzle.config.ts`, `db/seed.ts`.

- [ ] **Step 1: Create `db/schema.ts`**

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  domain: text("domain").notNull().unique(),
  rootPath: text("root_path").notNull(),
  sslEnabled: integer("ssl_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type ActivityLog = typeof activityLogs.$inferSelect;
```

- [ ] **Step 2: Create `db/index.ts`**

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(process.env.DATABASE_PATH ?? "panel.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: "./panel.db" },
} satisfies Config;
```

- [ ] **Step 4: Push schema to the DB**

Run: `npm run db:push`
Expected: drizzle-kit creates `panel.db` with `users`, `domains`, `activity_logs` tables.

- [ ] **Step 5: Create `db/seed.ts`**

```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { db } from "./index";
import { users } from "./schema";
import { hashPassword } from "../lib/auth/password";

function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env.local");
  }
  const passwordHash = hashPassword(password);
  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) {
    db.update(users).set({ passwordHash }).where(eq(users.username, username)).run();
    console.log(`Updated admin user: ${username}`);
  } else {
    db.insert(users).values({ username, passwordHash }).run();
    console.log(`Created admin user: ${username}`);
  }
}

main();
```

- [ ] **Step 6: Seed the admin user**

Run: `npm run db:seed`
Expected: prints `Created admin user: admin` (or your `ADMIN_USERNAME`).

- [ ] **Step 7: Commit**

```bash
git add db drizzle.config.ts
git commit -m "feat: add Drizzle schema, sqlite client, and admin seed"
```

---

## Task 9: Metrics parsers (TDD)

**Files:** Create `lib/system/metrics.ts`, `lib/system/metrics.test.ts`.

- [ ] **Step 1: Write the failing test** (pure parsers against captured fixtures)

`lib/system/metrics.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseCpuUsage, parseMemory, parseDisk, parseLoadAvg, parseUptime } from "./metrics";

describe("parseCpuUsage", () => {
  it("computes busy% across two /proc/stat samples", () => {
    const raw = [
      "cpu  100 0 100 800 0 0 0 0 0 0",
      "cpu0 50 0 50 400 0 0 0 0 0 0",
      "cpu  150 0 150 1000 0 0 0 0 0 0",
      "cpu0 75 0 75 500 0 0 0 0 0 0",
    ].join("\n");
    // totalΔ = (150+150+1000) - (100+100+800) = 1300-1000 = 300; idleΔ = 1000-800 = 200; busy = 100/300 = 33.3
    expect(parseCpuUsage(raw).usagePct).toBeCloseTo(33.3, 1);
  });
});

describe("parseMemory", () => {
  it("parses free -m and computes usage from available", () => {
    const raw = [
      "               total        used        free      shared  buff/cache   available",
      "Mem:            8000        3000        1000         100        4000        5000",
      "Swap:           2047           0        2047",
    ].join("\n");
    const m = parseMemory(raw);
    expect(m.totalMb).toBe(8000);
    expect(m.usedMb).toBe(3000);
    expect(m.availMb).toBe(5000);
    expect(m.usagePct).toBeCloseTo(37.5, 1); // (8000-5000)/8000
  });
});

describe("parseDisk", () => {
  it("parses df -P -BK / output", () => {
    const raw = [
      "Filesystem     1024-blocks      Used Available Capacity Mounted on",
      "/dev/sda1      61255492K  12000000K  49255492K      20% /",
    ].join("\n");
    const d = parseDisk(raw);
    expect(d.sizeKb).toBe(61255492);
    expect(d.usedKb).toBe(12000000);
    expect(d.availKb).toBe(49255492);
    expect(d.usagePct).toBe(20);
    expect(d.mount).toBe("/");
  });
});

describe("parseLoadAvg", () => {
  it("parses /proc/loadavg", () => {
    const d = parseLoadAvg("0.52 0.58 0.59 1/823 12345");
    expect(d).toEqual({ one: 0.52, five: 0.58, fifteen: 0.59 });
  });
});

describe("parseUptime", () => {
  it("parses /proc/uptime seconds", () => {
    expect(parseUptime("12345.67 98765.43")).toBe(12345);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/system/metrics.test.ts`
Expected: FAIL — cannot find module `./metrics`.

- [ ] **Step 3: Write minimal implementation** (parsers only for now)

`lib/system/metrics.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/system/metrics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/system/metrics.ts lib/system/metrics.test.ts
git commit -m "feat: add system metric parsers (cpu/mem/disk/load/uptime)"
```

---

## Task 10: `getMetrics()` gatherer

**Files:** Modify `lib/system/metrics.ts` (append type + gatherer).

- [ ] **Step 1: Append the `SystemMetrics` type and `getMetrics()` to `lib/system/metrics.ts`**

```ts
import { runOnTarget } from "@/lib/shell";

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
```

- [ ] **Step 2: Verify the live path against the running container**

Run:
```bash
npx tsx -e "import('./lib/system/metrics').then(async m => { process.env.USE_DOCKER='true'; console.log(await m.getMetrics()); })"
```
Expected: an object with non-null `cpu`/`memory`/`disk`/`load`/`uptimeSec`/`hostname` and empty `errors` (container must be up from Task 4).

- [ ] **Step 3: Verify tests still pass**

Run: `npx vitest run lib/system/metrics.test.ts`
Expected: PASS (5 tests, unchanged).

- [ ] **Step 4: Commit**

```bash
git add lib/system/metrics.ts
git commit -m "feat: add getMetrics gatherer with partial-error collection"
```

---

## Task 11: Activity service

**Files:** Create `lib/system/activity.ts`.

- [ ] **Step 1: Create `lib/system/activity.ts`**

```ts
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, type ActivityLog } from "@/db/schema";

export function logActivity(action: string, detail?: string): void {
  db.insert(activityLogs).values({ action, detail: detail ?? null }).run();
}

export function getRecentActivity(limit = 20): ActivityLog[] {
  return db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(limit).all();
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `npx tsx -e "import('./lib/system/activity').then(m => { m.logActivity('test','plan-verify'); console.log(m.getRecentActivity(5)); })"`
Expected: prints an array containing the just-inserted `test` row.

- [ ] **Step 3: Commit**

```bash
git add lib/system/activity.ts
git commit -m "feat: add activity log service"
```

---

## Task 12: NextAuth v5 split config + route protection

**Files:** Create `auth.config.ts`, `auth.ts`, `middleware.ts`, `app/api/auth/[...nextauth]/route.ts`.

- [ ] **Step 1: Create `auth.config.ts`** (edge-safe — NO db/bcrypt imports)

```ts
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = !!auth?.user;
      const onLogin = nextUrl.pathname.startsWith("/login");
      if (onLogin) {
        return loggedIn ? Response.redirect(new URL("/", nextUrl)) : true;
      }
      return loggedIn;
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Step 2: Create `auth.ts`** (Node — Credentials + bcrypt + db)

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "./db";
import { users } from "./db/schema";
import { verifyPassword } from "./lib/auth/password";
import { logActivity } from "./lib/system/activity";

const credsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;
        const user = db.select().from(users).where(eq(users.username, username)).get();
        if (!user) {
          logActivity("login_failed", `unknown user: ${username}`);
          return null;
        }
        if (!verifyPassword(password, user.passwordHash)) {
          logActivity("login_failed", `bad password: ${username}`);
          return null;
        }
        logActivity("login_success", username);
        return { id: user.id, name: user.username };
      },
    }),
  ],
});
```

- [ ] **Step 3: Create `app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Create `middleware.ts`** (uses ONLY the edge-safe config; excludes `/api` so the metrics route can return its own 401)

```ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 5: Verify build (split config must keep middleware edge-bundlable)**

Run: `npm run build`
Expected: build succeeds with no "module not found in edge runtime" / better-sqlite3 bundling errors in middleware.

- [ ] **Step 6: Commit**

```bash
git add auth.config.ts auth.ts middleware.ts "app/api/auth/[...nextauth]/route.ts"
git commit -m "feat: add NextAuth v5 split-config auth and route protection"
```

---

## Task 13: Login page + server action

**Files:** Create `app/(auth)/login/actions.ts`, `app/(auth)/login/page.tsx`.

- [ ] **Step 1: Create `app/(auth)/login/actions.ts`**

```ts
"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function login(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (err) {
    if (err instanceof AuthError) return "Invalid credentials";
    throw err; // re-throw the NEXT_REDIRECT control-flow signal on success
  }
}
```

- [ ] **Step 2: Create `app/(auth)/login/page.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, undefined);

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
      <form
        action={formAction}
        className="glass scan-sweep w-full max-w-sm rounded-xl p-8 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.85)]"
      >
        <div className="corner-ticks relative flex flex-col gap-6">
          <div>
            <p className="eyebrow">session · private</p>
            <h1 className="font-display mt-2 text-2xl font-bold tracking-wide text-white">rinpanel</h1>
          </div>

          <label className="flex flex-col gap-1">
            <span className="eyebrow">username</span>
            <input
              name="username"
              autoComplete="username"
              required
              className="h-11 rounded-md border border-white/10 bg-white/5 px-3 font-mono text-white placeholder:text-zinc-600 focus-visible:border-lime-500/60 focus-visible:ring-2 focus-visible:ring-lime-500/25 focus-visible:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="eyebrow">password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-11 rounded-md border border-white/10 bg-white/5 px-3 font-mono text-white placeholder:text-zinc-600 focus-visible:border-lime-500/60 focus-visible:ring-2 focus-visible:ring-lime-500/25 focus-visible:outline-none"
            />
          </label>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="accent-glow h-11 rounded-md bg-primary px-6 font-mono text-sm font-semibold tracking-wide text-primary-foreground uppercase disabled:opacity-60"
          >
            {pending ? "[ ·· ]" : "Authenticate"}
          </button>
        </div>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Manually verify login redirects** (dev server + container running)

Run: `npm run dev` then visit `http://localhost:3000/login`, submit valid creds (from `.env.local`).
Expected: redirects to `/` (which still shows the placeholder until Task 16); invalid creds show "Invalid credentials". Stop the dev server after checking (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)"
git commit -m "feat: add single-admin login page and server action"
```

---

## Task 14: Metrics API route (TDD with mocks)

**Files:** Create `app/api/system/metrics/route.ts`, `app/api/system/metrics/route.test.ts`.

- [ ] **Step 1: Write the failing test** (mock `@/auth` and the shell seam)

`app/api/system/metrics/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const runOnTargetMock = vi.fn();
vi.mock("@/lib/shell", () => ({ runOnTarget: (argv: string[]) => runOnTargetMock(argv) }));

import { GET } from "./route";

beforeEach(() => {
  authMock.mockReset();
  runOnTargetMock.mockReset();
});

describe("GET /api/system/metrics", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns metrics JSON when authenticated", async () => {
    authMock.mockResolvedValue({ user: { name: "admin" } });
    runOnTargetMock.mockImplementation((argv: string[]) => {
      const cmd = argv.join(" ");
      if (cmd.includes("/proc/stat")) return ok("cpu  100 0 100 800 0 0 0 0 0 0\ncpu  150 0 150 1000 0 0 0 0 0 0");
      if (cmd.includes("free")) return ok("Mem: 8000 3000 1000 100 4000 5000");
      if (cmd.includes("df")) return ok("h\n/dev/sda1 100K 20K 80K 20% /");
      if (cmd.includes("loadavg")) return ok("0.1 0.2 0.3 1/1 1");
      if (cmd.includes("uptime")) return ok("123.4 0");
      if (cmd.includes("hostname")) return ok("panel-server");
      return fail();
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hostname).toBe("panel-server");
    expect(body.cpu.usagePct).toBeGreaterThanOrEqual(0);
    expect(body.errors).toEqual([]);
  });

  it("returns partial data with errors when a read fails", async () => {
    authMock.mockResolvedValue({ user: { name: "admin" } });
    runOnTargetMock.mockImplementation((argv: string[]) => {
      if (argv.join(" ").includes("hostname")) return fail("boom");
      return ok("0.1 0.2 0.3 1/1 1");
    });
    const res = await GET();
    const body = await res.json();
    expect(body.hostname).toBeNull();
    expect(body.errors.some((e: string) => e.startsWith("hostname"))).toBe(true);
  });
});

function ok(stdout: string) {
  return Promise.resolve({ stdout, stderr: "", success: true });
}
function fail(stderr = "fail") {
  return Promise.resolve({ stdout: "", stderr, success: false });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/system/metrics/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write minimal implementation**

`app/api/system/metrics/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetrics } from "@/lib/system/metrics";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const metrics = await getMetrics();
  return NextResponse.json(metrics);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/system/metrics/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/system/metrics/route.ts app/api/system/metrics/route.test.ts
git commit -m "feat: add session-gated /api/system/metrics route"
```

---

## Task 15: PHOSPHOR app shell

**Files:** Create `components/app-shell/sidebar.tsx`, `app/(dashboard)/layout.tsx`.

- [ ] **Step 1: Create `components/app-shell/sidebar.tsx`** (client — needs active-route state)

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Globe, FolderOpen, ShieldCheck } from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", code: "01", icon: LayoutDashboard, enabled: true },
  { href: "/domains", label: "Domains", code: "02", icon: Globe, enabled: false },
  { href: "/files", label: "Files", code: "03", icon: FolderOpen, enabled: false },
  { href: "/ssl", label: "SSL", code: "04", icon: ShieldCheck, enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="bg-sidebar/80 sticky top-0 flex h-screen w-16 shrink-0 flex-col gap-6 border-r border-white/10 px-2 py-5 backdrop-blur-xl md:w-64 md:px-4">
      <div className="flex items-center gap-3 px-1">
        <span className="accent-glow grid size-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">R</span>
        <span className="font-display hidden text-lg font-bold tracking-wide text-white md:block">rinpanel</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          const base = "relative flex items-center gap-3 rounded-md px-2 py-2 font-mono text-[0.8rem] tracking-wide uppercase md:px-3";
          if (!item.enabled) {
            return (
              <span key={item.href} className={`${base} cursor-not-allowed text-zinc-600`} title="Coming in a later slice">
                <Icon className="size-4 shrink-0" />
                <span className="hidden md:block">{item.label}</span>
                <span className="ml-auto hidden text-zinc-700 md:block">{item.code}</span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${base} ${active ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
            >
              {active && <span className="absolute -left-2 h-5 w-0.5 bg-primary" />}
              <Icon className="size-4 shrink-0" />
              <span className="hidden md:block">{item.label}</span>
              <span className={`ml-auto hidden md:block ${active ? "text-primary-foreground/70" : "text-zinc-600"}`}>{item.code}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 px-2 font-mono text-[0.65rem] text-zinc-500">
        <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
        <span className="hidden md:block">SESSION · PRIVATE</span>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create `app/(dashboard)/layout.tsx`** (server — auth-gated shell)

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/app-shell/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="relative z-10 flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden p-4 md:p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds; `(dashboard)` route group compiles.

- [ ] **Step 4: Commit**

```bash
git add components/app-shell "app/(dashboard)/layout.tsx"
git commit -m "feat: add PHOSPHOR app shell with collapsing sidebar"
```

---

## Task 16: Dashboard UI components

**Files:** Create `lib/hooks/use-polling.ts`, `components/dashboard/{status-dot,usage-bar,stat-tile,activity-log,live-dashboard}.tsx`.

- [ ] **Step 1: Create `lib/hooks/use-polling.ts`**

```ts
"use client";

import { useEffect, useState } from "react";

export interface PollState<T> {
  data: T | null;
  error: boolean;
  loading: boolean;
}

export function usePolling<T>(url: string, intervalMs: number): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: false, loading: true });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as T;
        if (active) setState({ data, error: false, loading: false });
      } catch (e) {
        if (active && !(e instanceof DOMException && e.name === "AbortError")) {
          setState((s) => ({ data: s.data, error: true, loading: false }));
        }
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, [url, intervalMs]);

  return state;
}
```

- [ ] **Step 2: Create `components/dashboard/status-dot.tsx`**

```tsx
export function StatusDot({ state }: { state: "live" | "error" | "loading" }) {
  const color = state === "live" ? "bg-emerald-400" : state === "error" ? "bg-red-400" : "bg-amber-400";
  const label = state === "live" ? "LIVE" : state === "error" ? "UNREACHABLE" : "CONNECTING";
  return (
    <span className="flex items-center gap-2 font-mono text-[0.65rem] tracking-wide text-zinc-400 uppercase">
      <span className={`size-1.5 rounded-full ${color} animate-glow-pulse`} />
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Create `components/dashboard/usage-bar.tsx`** (semantic color ramp per design.md §2)

```tsx
function gradeClasses(pct: number): { text: string; bar: string } {
  if (pct >= 80) return { text: "text-red-400", bar: "bg-red-500" };
  if (pct >= 60) return { text: "text-amber-400", bar: "bg-amber-500" };
  if (pct >= 40) return { text: "text-sky-400", bar: "bg-sky-500" };
  return { text: "text-emerald-400", bar: "bg-emerald-500" };
}

export function UsageBar({ pct }: { pct: number }) {
  const g = gradeClasses(pct);
  return (
    <div className="flex flex-col gap-1.5">
      <span className={`font-mono text-2xl font-bold tabular-nums ${g.text}`}>{pct.toFixed(1)}%</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/5">
        <div className={`h-full rounded-full ${g.bar}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `components/dashboard/stat-tile.tsx`**

```tsx
export function StatTile({ label, code, children }: { label: string; code?: string; children: React.ReactNode }) {
  return (
    <div className="glass corner-ticks relative flex flex-col gap-3 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {code && <span className="eyebrow text-zinc-600">{code}</span>}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Create `components/dashboard/activity-log.tsx`**

```tsx
import type { ActivityLog } from "@/db/schema";

export function ActivityLogView({ entries }: { entries: ActivityLog[] }) {
  return (
    <div className="glass rounded-xl p-5">
      <span className="eyebrow">Activity · last 20</span>
      <ul className="mt-4 flex flex-col gap-2 border-l border-white/10 pl-4 font-mono text-sm">
        {entries.length === 0 && <li className="text-zinc-600">▸ no activity recorded</li>}
        {entries.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3">
            <span className="text-zinc-600">{new Date(e.createdAt).toLocaleTimeString()}</span>
            <span className={e.action === "login_failed" ? "text-amber-400" : "text-emerald-400"}>▸ {e.action}</span>
            {e.detail && <span className="truncate text-zinc-500">{e.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Create `components/dashboard/live-dashboard.tsx`** (client island; polls metrics)

```tsx
"use client";

import { usePolling } from "@/lib/hooks/use-polling";
import type { SystemMetrics } from "@/lib/system/metrics";
import { StatusDot } from "./status-dot";
import { StatTile } from "./stat-tile";
import { UsageBar } from "./usage-bar";

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export function LiveDashboard() {
  const { data, error, loading } = usePolling<SystemMetrics>("/api/system/metrics", 3000);
  const state = error ? "error" : loading ? "loading" : "live";
  const unreachable = !!data && data.errors.length > 0 && data.cpu === null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">module 01 · telemetry</p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-wide text-white">
            {data?.hostname ?? "—"}
          </h1>
        </div>
        <StatusDot state={state} />
      </div>

      {unreachable && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 font-mono text-sm text-red-300">
          ▸ Linux box unreachable — is the panel-server container running?
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="CPU" code="%">
          {data?.cpu ? <UsageBar pct={data.cpu.usagePct} /> : <Dash />}
        </StatTile>
        <StatTile label="Memory" code="MB">
          {data?.memory ? (
            <div className="flex flex-col gap-1.5">
              <UsageBar pct={data.memory.usagePct} />
              <span className="font-mono text-xs text-zinc-500">{data.memory.usedMb} / {data.memory.totalMb} MB</span>
            </div>
          ) : <Dash />}
        </StatTile>
        <StatTile label="Disk" code={data?.disk?.mount ?? "/"}>
          {data?.disk ? (
            <div className="flex flex-col gap-1.5">
              <UsageBar pct={data.disk.usagePct} />
              <span className="font-mono text-xs text-zinc-500">{(data.disk.usedKb / 1048576).toFixed(1)} / {(data.disk.sizeKb / 1048576).toFixed(1)} GB</span>
            </div>
          ) : <Dash />}
        </StatTile>
        <StatTile label="Load · Uptime">
          {data?.load && data.uptimeSec != null ? (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-2xl font-bold tabular-nums text-lime-400">{data.load.one.toFixed(2)}</span>
              <span className="font-mono text-xs text-zinc-500">{data.load.five.toFixed(2)} · {data.load.fifteen.toFixed(2)} · up {fmtUptime(data.uptimeSec)}</span>
            </div>
          ) : <Dash />}
        </StatTile>
      </div>
    </section>
  );
}

function Dash() {
  return <span className="font-mono text-2xl text-zinc-700">—</span>;
}
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: build succeeds; `SystemMetrics` type imports cleanly into the client component (type-only import is erased).

- [ ] **Step 8: Commit**

```bash
git add lib/hooks components/dashboard
git commit -m "feat: add live dashboard widgets and polling hook"
```

---

## Task 17: Dashboard page + end-to-end visual QA

**Files:** Create `app/(dashboard)/page.tsx`, `scripts/visual-qa.py`; Delete `app/page.tsx`.

- [ ] **Step 1: Remove the placeholder root page** (the `(dashboard)` group now owns `/`)

Run: `git rm app/page.tsx`
Expected: file removed (the `(dashboard)/page.tsx` below renders at `/`).

- [ ] **Step 2: Create `app/(dashboard)/page.tsx`**

```tsx
import { getRecentActivity } from "@/lib/system/activity";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { ActivityLogView } from "@/components/dashboard/activity-log";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const activity = getRecentActivity(20);
  return (
    <div className="flex flex-col gap-6">
      <LiveDashboard />
      <ActivityLogView entries={activity} />
    </div>
  );
}
```

- [ ] **Step 3: Verify the full app builds**

Run: `npm run build`
Expected: build succeeds with `/`, `/login`, `/api/system/metrics`, `/api/auth/[...nextauth]` routes listed.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass (password ×3, shell ×3, metrics ×5, metrics-route ×3).

- [ ] **Step 5: Create `scripts/visual-qa.py`** (Playwright login + screenshots)

```python
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
USER = "admin"          # match ADMIN_USERNAME in .env.local
PASSWORD = "REPLACE"    # match ADMIN_PASSWORD in .env.local

def shoot(page, width, name):
    page.set_viewport_size({"width": width, "height": 900})
    page.wait_for_timeout(3500)  # let one poll tick land
    page.screenshot(path=name, full_page=True)
    print("saved", name)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(f"{BASE}/login")
    page.fill('input[name="username"]', USER)
    page.fill('input[name="password"]', PASSWORD)
    page.click('button[type="submit"]')
    page.wait_for_url(f"{BASE}/")
    shoot(page, 1280, "qa-dashboard-desktop.png")
    shoot(page, 390, "qa-dashboard-mobile.png")
    b.close()
```

- [ ] **Step 6: Run the app and capture screenshots** (container must be up)

Run (in two shells, or background the dev server):
```bash
docker compose up -d
npm run dev &       # wait until "Ready"
# edit scripts/visual-qa.py PASSWORD to match .env.local, then:
python3 scripts/visual-qa.py
```
Expected: `qa-dashboard-desktop.png` and `qa-dashboard-mobile.png` are written.

- [ ] **Step 7: Inspect the screenshots** (read both files)

Verify: dark PHOSPHOR canvas, lime accent, mono telemetry, four stat tiles showing live CPU/Memory/Disk/Load values, activity feed listing the `login_success` event, sidebar collapsed to icons at 390px. Confirm values change on a second run (live polling). If styling is off, fix the relevant component and re-run before committing.

- [ ] **Step 8: Stop the dev server, ignore QA artifacts, commit**

```bash
kill %1 2>/dev/null   # stop backgrounded dev server
echo "qa-*.png" >> .gitignore
git add "app/(dashboard)/page.tsx" scripts/visual-qa.py .gitignore
git rm --cached app/page.tsx 2>/dev/null; git add -A
git commit -m "feat: wire dashboard page with live telemetry and activity feed"
```

- [ ] **Step 9: Push the completed slice**

Run: `git push`
Expected: `main` updated on `github.com/rinebyte/rinpanel`. (Confirm with the user before pushing if they prefer to review first.)

---

## Self-Review (completed during planning)

- **Spec coverage:** scaffold (T1), deps/Vitest (T2), env+AUTH_SECRET (T3), Docker box (T4), PHOSPHOR globals/fonts (T5), bcryptjs util (T6), shell seam with argv arrays (T7), Drizzle schema/seed with `passwordHash` (T8), parsers (T9), `getMetrics` partial-errors (T10), activity service (T11), split-config auth + middleware + route protection (T12), login UX with generic error + activity logging (T13), 401 metrics route (T14), PHOSPHOR shell mobile-first (T15), polling dashboard + semantic ramp (T16), dashboard wiring + Playwright QA at 390px/desktop (T17). All §3 in-scope items and §11 acceptance criteria map to tasks. `node-pty`, Nginx/domain/file/SSL features correctly absent (later slices).
- **Placeholder scan:** no "TBD/TODO/implement later"; the only `REPLACE` is the QA script password the operator substitutes from `.env.local` (called out in T17 Step 6).
- **Type consistency:** `ShellResult`, `runOnTarget`, `SystemMetrics`, `parseCpuUsage/parseMemory/parseDisk/parseLoadAvg/parseUptime`, `getMetrics`, `hashPassword/verifyPassword`, `logActivity/getRecentActivity`, `ActivityLog`, `usePolling`, `StatTile/StatusDot/UsageBar/ActivityLogView/LiveDashboard`, `Sidebar` — names are used consistently across tasks and match the spec.
