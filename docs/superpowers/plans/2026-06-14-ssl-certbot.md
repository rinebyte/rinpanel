# rinpanel Slice S: SSL via Certbot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Per-domain "Enable SSL" / "Disable SSL" wrapping `certbot --nginx`, with a `CERTBOT_DRY_RUN` toggle for safe dev testing.

**Architecture:** Add `lib/nginx/ssl.ts` (pure argv builder + thin enable/disable service) and two server actions in the existing `app/(dashboard)/domains/actions.ts`. UI adds two more `<dialog>` components reused on `DomainRow`. `disableSsl` reuses Slice N's `applyVhost` to re-render the HTTP-only template. State lives in the existing `domains.sslEnabled` column.

**Source of truth:** `docs/superpowers/specs/2026-06-14-ssl-certbot-design.md`.

**Tech Stack:** Existing — no new deps.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/nginx/ssl.ts` (+ `.test.ts`) | `buildEnableArgv` (pure, TDD) + `enableSsl` / `disableSsl` |
| `app/(dashboard)/domains/actions.ts` | MODIFY: add `enableDomainSsl` + `disableDomainSsl` |
| `components/domains/enable-ssl-dialog.tsx` | NEW client `<dialog>` with command preview + DNS warning |
| `components/domains/disable-ssl-dialog.tsx` | NEW client `<dialog>` (red destructive variant) |
| `components/domains/domain-row.tsx` | MODIFY: SSL chip + ENABLE SSL button / ShieldOff disable trigger |
| `.env.example` | MODIFY: add `LETS_ENCRYPT_EMAIL=` + `CERTBOT_DRY_RUN=true` |
| `.env.production.example` | MODIFY: add the same with `CERTBOT_DRY_RUN=false` |
| `DEPLOY.md` | MODIFY: note `CERTBOT_DRY_RUN=false` + `LETS_ENCRYPT_EMAIL` in §3 |

---

## Task S-1: `buildEnableArgv` (TDD)

**Files:** Create `lib/nginx/ssl.ts` (initial), `lib/nginx/ssl.test.ts`.

- [ ] **Step 1: Write the failing test**

`lib/nginx/ssl.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildEnableArgv } from "./ssl";

describe("buildEnableArgv", () => {
  it("produces a non-dry-run argv with the supplied email + domain", () => {
    expect(buildEnableArgv("example.com", "ops@example.com", false)).toEqual([
      "certbot", "--nginx",
      "--non-interactive", "--agree-tos",
      "-m", "ops@example.com",
      "-d", "example.com",
      "--redirect",
    ]);
  });
  it("appends --dry-run when enabled", () => {
    const a = buildEnableArgv("foo.bar.co", "x@y.z", true);
    expect(a.at(-1)).toBe("--dry-run");
    expect(a).toContain("-d");
    expect(a).toContain("foo.bar.co");
  });
  it("preserves '+' in email addresses without URL encoding", () => {
    const a = buildEnableArgv("example.com", "me+tag@example.com", false);
    const i = a.indexOf("-m");
    expect(a[i + 1]).toBe("me+tag@example.com");
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npx vitest run lib/nginx/ssl.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the pure builder**

`lib/nginx/ssl.ts`:
```ts
export function buildEnableArgv(domain: string, email: string, dryRun: boolean): string[] {
  const argv = [
    "certbot", "--nginx",
    "--non-interactive", "--agree-tos",
    "-m", email,
    "-d", domain,
    "--redirect",
  ];
  if (dryRun) argv.push("--dry-run");
  return argv;
}
```

- [ ] **Step 4: Confirm pass**

Run: `npx vitest run lib/nginx/ssl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add lib/nginx/ssl.ts lib/nginx/ssl.test.ts
git commit -m "feat(slice-s): add buildEnableArgv (TDD)"
```

---

## Task S-2: `enableSsl` / `disableSsl` service ops

**Files:** Modify `lib/nginx/ssl.ts`.

- [ ] **Step 1: Append the service ops**

```ts
import { runOnTarget } from "@/lib/shell";
import { applyVhost } from "./vhost";

export type SslResult =
  | { ok: true; output: string; dryRun?: boolean }
  | { ok: false; error: string; output: string };

function useDryRun(): boolean {
  return process.env.CERTBOT_DRY_RUN !== "false"; // default true (safe)
}

function adminEmail(): string | null {
  return process.env.LETS_ENCRYPT_EMAIL?.trim() || null;
}

export async function enableSsl(domain: string): Promise<SslResult> {
  const email = adminEmail();
  if (!email) return { ok: false, error: "LETS_ENCRYPT_EMAIL must be set in .env.local", output: "" };

  const confCheck = await runOnTarget(["test", "-f", `/etc/nginx/sites-available/${domain}.conf`]);
  if (!confCheck.success) {
    return { ok: false, error: `vhost not provisioned for ${domain}`, output: "" };
  }

  const dryRun = useDryRun();
  const r = await runOnTarget(buildEnableArgv(domain, email, dryRun));
  const output = `${r.stdout}\n${r.stderr}`.trim();

  if (!r.success) {
    return { ok: false, error: (r.stderr || "certbot failed").split("\n").slice(-3).join("\n"), output };
  }

  if (dryRun) return { ok: true, output, dryRun: true };

  // Real run only: certbot edited the conf; verify nginx + reload
  const t = await runOnTarget(["nginx", "-t"]);
  if (!t.success) {
    return { ok: false, error: `nginx -t failed after certbot: ${t.stderr}`, output };
  }
  await runOnTarget(["nginx", "-s", "reload"]);
  return { ok: true, output };
}

export async function disableSsl(domain: string): Promise<SslResult> {
  const r = await runOnTarget(["certbot", "delete", "--cert-name", domain, "--non-interactive"]);
  const output = `${r.stdout}\n${r.stderr}`.trim();

  // certbot delete errors when no cert exists; treat as soft-success because the goal is "SSL off"
  // either way. Surface a notice in the output if it failed.

  // Re-render the HTTP-only vhost
  const re = await applyVhost(domain);
  if (!re.ok) return { ok: false, error: `re-apply vhost failed: ${re.error}`, output };

  return { ok: true, output };
}
```

- [ ] **Step 2: Verify type-check + ssl tests still pass**

Run:
```
npx tsc --noEmit
npx vitest run lib/nginx/ssl.test.ts
```
Expected: clean tsc; the existing 3 buildEnableArgv tests still pass (no new tests yet — service ops are exercised by the live container integration tests if we choose to add them, OR by the Playwright e2e in S-5).

- [ ] **Step 3: Commit**

```
git add lib/nginx/ssl.ts
git commit -m "feat(slice-s): add enableSsl + disableSsl service ops"
```

---

## Task S-3: Server actions

**Files:** Modify `app/(dashboard)/domains/actions.ts` (append two actions).

- [ ] **Step 1: Append to `app/(dashboard)/domains/actions.ts`**

```ts
import { enableSsl, disableSsl } from "@/lib/nginx/ssl";

export interface SslActionResult {
  ok: boolean;
  error?: string;
  output?: string;
  dryRun?: boolean;
}

export async function enableDomainSsl(_prev: SslActionResult | undefined, formData: FormData): Promise<SslActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  const r = await enableSsl(row.domain);
  if (!r.ok) return { ok: false, error: r.error, output: r.output };

  // Skip DB flip on dry-run — dry-run isn't a real enable
  if (!r.dryRun) {
    db.update(domains)
      .set({ sslEnabled: true, updatedAt: new Date() })
      .where(eq(domains.id, id))
      .run();
    logActivity("domain_ssl_enable", row.domain);
  }
  revalidatePath("/domains");
  return { ok: true, output: r.output, dryRun: r.dryRun };
}

export async function disableDomainSsl(_prev: SslActionResult | undefined, formData: FormData): Promise<SslActionResult> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const row = db.select().from(domains).where(eq(domains.id, id)).get();
  if (!row) return { ok: false, error: "domain not found" };

  const r = await disableSsl(row.domain);
  if (!r.ok) return { ok: false, error: r.error, output: r.output };

  db.update(domains)
    .set({ sslEnabled: false, updatedAt: new Date() })
    .where(eq(domains.id, id))
    .run();
  logActivity("domain_ssl_disable", row.domain);

  revalidatePath("/domains");
  return { ok: true, output: r.output };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean. The `enableSsl` / `disableSsl` imports resolve.

- [ ] **Step 3: Commit**

```
git add "app/(dashboard)/domains/actions.ts"
git commit -m "feat(slice-s): add enableDomainSsl + disableDomainSsl server actions"
```

---

## Task S-4: Dialogs + row UI

**Files:** Create `components/domains/enable-ssl-dialog.tsx`, `components/domains/disable-ssl-dialog.tsx`; Modify `components/domains/domain-row.tsx`.

- [ ] **Step 1: `components/domains/enable-ssl-dialog.tsx`**

```tsx
"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useState } from "react";
import { enableDomainSsl, type SslActionResult } from "@/app/(dashboard)/domains/actions";

export interface EnableSslDialogHandle { open: () => void; close: () => void }
interface Props { id: string; domain: string; email?: string; dryRun: boolean }

export const EnableSslDialog = forwardRef<EnableSslDialogHandle, Props>(function EnableSslDialog({ id, domain, email, dryRun }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [state, formAction] = useActionState<SslActionResult | undefined, FormData>(
    async (prev, fd) => { setPhase("running"); const out = await enableDomainSsl(prev, fd); setPhase("done"); return out; },
    undefined,
  );
  useImperativeHandle(ref, () => ({
    open: () => { setPhase("idle"); r.current?.showModal(); },
    close: () => r.current?.close(),
  }));

  const cmd = `certbot --nginx -n --agree-tos -m ${email ?? "<LETS_ENCRYPT_EMAIL>"} -d ${domain}${dryRun ? " --dry-run" : ""}`;

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={formAction} className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="id" value={id} />
        <div>
          <p className="eyebrow">vhost · enable ssl</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">enable SSL?</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">domain · </span>
            <span className="text-zinc-200">{domain}</span>
          </p>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-300">
          ▸ DNS untuk {domain} harus sudah resolve ke server ini.
          {dryRun && <div className="mt-1 text-amber-200/80">[dev] CERTBOT_DRY_RUN=true — gonna run --dry-run only.</div>}
        </div>

        <pre className="overflow-auto rounded-md border border-white/5 bg-black/40 p-3 font-mono text-[0.7rem] text-lime-200/90">{cmd}</pre>

        {state?.output && (
          <pre className="max-h-48 overflow-auto rounded-md border border-white/5 bg-black/40 p-3 font-mono text-[0.65rem] text-zinc-300">{state.output}</pre>
        )}

        {state?.ok && (
          <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
            {state.dryRun ? "dry-run successful (no cert installed)" : "SSL enabled"}
          </p>
        )}

        {state && !state.ok && state.error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            failed: {state.error}
          </p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            {state ? "Close" : "Cancel"}
          </button>
          {!state && (
            <button type="submit" disabled={phase === "running"}
              className="accent-glow h-10 flex-1 rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground disabled:opacity-60">
              {phase === "running" ? "[ ·· ] issuing cert" : "Enable SSL"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
});
```

- [ ] **Step 2: `components/domains/disable-ssl-dialog.tsx`**

```tsx
"use client";

import { forwardRef, useImperativeHandle, useRef, useActionState, useState } from "react";
import { disableDomainSsl, type SslActionResult } from "@/app/(dashboard)/domains/actions";

export interface DisableSslDialogHandle { open: () => void; close: () => void }
interface Props { id: string; domain: string }

export const DisableSslDialog = forwardRef<DisableSslDialogHandle, Props>(function DisableSslDialog({ id, domain }, ref) {
  const r = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [state, formAction] = useActionState<SslActionResult | undefined, FormData>(
    async (prev, fd) => { setPhase("running"); const out = await disableDomainSsl(prev, fd); setPhase("done"); return out; },
    undefined,
  );
  useImperativeHandle(ref, () => ({
    open: () => { setPhase("idle"); r.current?.showModal(); },
    close: () => r.current?.close(),
  }));

  return (
    <dialog ref={r} className="glass corner-ticks relative m-auto rounded-xl p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal">
      <form action={formAction} className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-5 p-6">
        <input type="hidden" name="id" value={id} />
        <div>
          <p className="eyebrow">vhost · disable ssl</p>
          <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">disable SSL?</h2>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            <span className="text-zinc-500">domain · </span>
            <span className="text-zinc-200">{domain}</span>
          </p>
        </div>

        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-300">
          ▸ cert akan dihapus, vhost balik ke HTTP-only.
        </p>

        {state?.output && (
          <pre className="max-h-32 overflow-auto rounded-md border border-white/5 bg-black/40 p-3 font-mono text-[0.65rem] text-zinc-300">{state.output}</pre>
        )}

        {state && !state.ok && state.error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            failed: {state.error}
          </p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => r.current?.close()}
            className="h-10 flex-1 rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white">
            {state?.ok ? "Close" : "Cancel"}
          </button>
          {!state?.ok && (
            <button type="submit" disabled={phase === "running"}
              className="h-10 flex-1 rounded-md border border-red-500/40 bg-red-500/10 font-mono text-xs font-semibold tracking-wide uppercase text-red-300 hover:border-red-500/60 hover:bg-red-500/20 disabled:opacity-60">
              {phase === "running" ? "[ ·· ] removing" : "Disable SSL"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
});
```

- [ ] **Step 3: Modify `components/domains/domain-row.tsx`**

Add imports:
```tsx
import { Lock, ShieldOff } from "lucide-react";
import { EnableSslDialog, type EnableSslDialogHandle } from "./enable-ssl-dialog";
import { DisableSslDialog, type DisableSslDialogHandle } from "./disable-ssl-dialog";
```

Inside the component body, add refs:
```tsx
const enableSslRef = useRef<EnableSslDialogHandle>(null);
const disableSslRef = useRef<DisableSslDialogHandle>(null);
```

In the static chip area (`<span className="rounded-sm border border-lime-500/30 ...">static</span>`), add an `SSL` chip alongside it when `row.sslEnabled`:
```tsx
{row.sslEnabled && (
  <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.55rem] tracking-wider text-emerald-300 uppercase">
    ssl
  </span>
)}
```

In the actions group (next to Pencil/Trash), insert before the rename Pencil:
```tsx
{row.sslEnabled ? (
  <button
    type="button"
    onClick={() => disableSslRef.current?.open()}
    aria-label="Disable SSL"
    className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
  >
    <ShieldOff className="size-4" />
  </button>
) : (
  <button
    type="button"
    onClick={() => enableSslRef.current?.open()}
    aria-label="Enable SSL"
    className="grid size-9 place-items-center rounded-md text-zinc-500 hover:border-lime-500/30 hover:bg-lime-500/10 hover:text-lime-300"
  >
    <Lock className="size-4" />
  </button>
)}
```

And mount both dialogs at the bottom of the row JSX (next to `<DeleteDialog ... />`):
```tsx
<EnableSslDialog ref={enableSslRef} id={row.id} domain={row.domain} email={process.env.LETS_ENCRYPT_EMAIL_UI} dryRun={true} />
<DisableSslDialog ref={disableSslRef} id={row.id} domain={row.domain} />
```

**Heads-up:** `process.env` in client components doesn't expose runtime values; for the email + dryRun display in the dialog, we need them as props from the server. Adjust by reading them in the parent (`(dashboard)/domains/page.tsx`) and passing them down:

In `app/(dashboard)/domains/page.tsx`, change the row map to:
```tsx
const sslEmail = process.env.LETS_ENCRYPT_EMAIL ?? "";
const dryRun = process.env.CERTBOT_DRY_RUN !== "false";
// ...
{rows.map((r) => <DomainRow key={r.id} row={r} sslEmail={sslEmail} sslDryRun={dryRun} />)}
```

In `domain-row.tsx`, accept the props and pass them to `EnableSslDialog`:
```tsx
interface Props { row: Domain; sslEmail: string; sslDryRun: boolean }
// ...
<EnableSslDialog ref={enableSslRef} id={row.id} domain={row.domain} email={sslEmail} dryRun={sslDryRun} />
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```
git add components/domains "app/(dashboard)/domains/page.tsx"
git commit -m "feat(slice-s): add SSL enable/disable dialogs + row UI"
```

---

## Task S-5: Env templates + DEPLOY.md update

**Files:** Modify `.env.example`, `.env.production.example`, `DEPLOY.md`.

- [ ] **Step 1: `.env.example`** — append:
```
# Slice S (SSL) — set the email used as Let's Encrypt account contact.
LETS_ENCRYPT_EMAIL=
# Dev default: dry-run (no real cert issued).
CERTBOT_DRY_RUN=true
```

- [ ] **Step 2: `.env.production.example`** — append:
```
# Slice S (SSL).
LETS_ENCRYPT_EMAIL=
# Production: false = issue real certs against Let's Encrypt prod.
CERTBOT_DRY_RUN=false
```

- [ ] **Step 3: `DEPLOY.md` §3** — add to the env-fill list:
- `LETS_ENCRYPT_EMAIL` — admin email for Let's Encrypt account / expiry notices.
- `CERTBOT_DRY_RUN=false` — required for real cert issuance.

- [ ] **Step 4: Commit**

```
git add .env.example .env.production.example DEPLOY.md
git commit -m "feat(slice-s): add LETS_ENCRYPT_EMAIL + CERTBOT_DRY_RUN env config"
```

---

## Task S-6: Live QA + merge

- [ ] **Step 1: Start container + dev**

```bash
docker compose up -d
# Ensure LETS_ENCRYPT_EMAIL is set in .env.local (any plausible value for dry-run)
npm run dev &
```

- [ ] **Step 2: Run Playwright e2e** (adapt prior QA pattern)

Verify:
1. Login → /domains. Add `qa-ssl-test.localdomain`.
2. Verify row shows `STATIC` chip + lock icon (no SSL chip).
3. Click lock → EnableSslDialog opens, shows the command preview with `--dry-run` flag and the DNS warning banner.
4. Click "Enable SSL" → button morphs to `[ ·· ] issuing cert` → after completion: either:
   - dry-run success: emerald "dry-run successful (no cert installed)" banner; DB row's `sslEnabled` stays `false` (verify); no audit event for enable.
   - dry-run failure (likely if DNS doesn't resolve): red banner with certbot stderr captured in a code block. DB stays `false`.
5. Open the disable dialog from a row marked SSL-on (you can manually flip the DB to `sslEnabled=true` for the test, then click ShieldOff). Confirm disable → row's SSL chip disappears.
6. Mobile shot (390 px).

- [ ] **Step 3: Audit log check**

```bash
node -e "const D=require('better-sqlite3');const db=new D('panel.db');console.log(db.prepare(\\"select action, detail from activity_logs where action like 'domain_ssl_%' order by created_at desc limit 5\\").all())"
```
Expected: `domain_ssl_disable` row from the disable test. No `domain_ssl_enable` row from dry-run (correct — dry-run doesn't flip state or audit).

- [ ] **Step 4: Stop dev, suite + build**

```bash
pkill -f "next dev"
npm test
npm run build
```
Expected: 37 baseline + 3 ssl unit tests + Fs tests (if Fs has merged first) all passing.

- [ ] **Step 5: Merge**

```bash
git checkout main
git merge --no-ff slice-s-ssl -m "merge: slice S — SSL via certbot (enable/disable, dry-run dev mode)"
npm test
git branch -d slice-s-ssl
git push origin main
```

---

## Self-review

- **Spec coverage:** argv builder TDD (S-1), service ops with dry-run + email check (S-2), server actions + DB-skip on dry-run (S-3), two dialogs + row UI (S-4), env templates + DEPLOY.md update (S-5), live QA + merge (S-6). All §3 in-scope and §13 acceptance criteria map to tasks.
- **Type consistency:** `SslResult` / `SslActionResult` / `EnableSslDialogHandle` / `DisableSslDialogHandle` used consistently.
- **Placeholder scan:** none. `process.env.LETS_ENCRYPT_EMAIL_UI` shown in an intermediate version of the row prop wiring is corrected with the props-from-server pattern in S-4 Step 3 footnote.
- **UI consistency:** matches the contract — `<dialog>` confirm, PHOSPHOR semantic ramp (amber warning, emerald success, red destructive), eyebrow + display title, mono command preview in code block.
