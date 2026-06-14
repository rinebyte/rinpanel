# rinpanel — Slice S: SSL via Certbot (Design Spec)

- **Date:** 2026-06-14
- **Status:** Approved (brainstorm) → ready for plan
- **Depends on:** Slice 1, Polish, Slice N (must), Slice Fs (no — independent)
- **Sibling docs:** `design.md` (PHOSPHOR), `CLAUDE.md`, prior specs in `docs/superpowers/specs/`

## 1. Context & goal

Slice S adds **HTTPS for hosted vhosts** by wrapping `certbot --nginx`. After this slice, every vhost provisioned by Slice N gets a one-click "Enable SSL" button → certbot solves the HTTP-01 challenge through nginx → rewrites the vhost to add a `:443 ssl` block + a `:80 → :443` redirect → installs auto-renewal.

The user already has `certbot` + `python3-certbot-nginx` installed in the dev container (Slice 1's Dockerfile) and on the prod VPS (per `DEPLOY.md` §1). This slice is mostly a thin **service wrapper + UI** around `certbot --nginx`, plus a persistent `sslEnabled` flag in the DB.

## 2. Decisions locked during brainstorming

1. **Trigger:** per-domain action on `/domains` (NOT a separate `/ssl` page). SSL is a per-vhost attribute; integrating into the existing row keeps the mental model simple.
2. **Backend:** `certbot --nginx --non-interactive --agree-tos -m <admin-email> -d <domain>`. Certbot edits the vhost file in place and installs its own renewal timer.
3. **Dev mode:** `CERTBOT_DRY_RUN=true` (default in `.env.example`) appends `--dry-run`. This validates the flow end-to-end without burning Let's Encrypt rate limits or requiring real DNS. Prod sets `CERTBOT_DRY_RUN=false`.
4. **Email:** new env var `LETS_ENCRYPT_EMAIL`. Required when enabling SSL (server action returns clear error if unset). Same value used for all vhosts.
5. **State:** `sslEnabled` boolean on the `domains` row (already exists from Slice 1's schema). Set true after successful certbot run; flipped to false on disable.
6. **Disable:** UI button on SSL-enabled rows runs `certbot delete --cert-name <domain> --non-interactive` then re-applies the vhost via the existing `applyVhost(domain)` (which renders the plain HTTP-only template). DB flag flips back.
7. **Renewal:** certbot installs its own systemd timer (Ubuntu / Debian default). rinpanel does NOT need to schedule renewals; we just need to not break the auto-renewer.
8. **No audit-log spam from renewals:** renewals happen outside rinpanel, so they don't pass through `logActivity`. Only user-triggered enable/disable land in the audit log.

## 3. Scope

**In scope**
- New service `lib/nginx/ssl.ts` — `enableSsl(domain)` and `disableSsl(domain)` with rollback semantics.
- Server actions: `enableDomainSsl(formData)` / `disableDomainSsl(formData)` — auth-gated, validate, run service, update DB, audit.
- UI changes:
  - SSL state chip in `DomainRow`: lime "SSL · ON" if enabled; an `+ ENABLE SSL` button otherwise.
  - Confirm `<dialog>` for enable AND disable (since enable can take 10–30 s and can fail loudly).
  - Pending state shows `[ ·· ] issuing cert` / `[ ·· ] removing cert` with the certbot stdout streaming below.
- `.env.example` + `.env.production.example` get `LETS_ENCRYPT_EMAIL=` + `CERTBOT_DRY_RUN=` lines.
- Tests: TDD on the argv construction (pure function); integration tests against the live container with `--dry-run`; Playwright e2e.

**Out of scope (later or never)**
- Wildcard certs (DNS-01 challenge — requires DNS API integration; not needed for static hosting).
- Multi-domain certs (`-d foo.com -d www.foo.com` in one cert).
- Custom cert upload (BYO cert).
- Per-domain email overrides.
- Renewal status / "days until expiry" dashboard widget.
- ACME account management UI.
- SSL labs grade meter / cipher tuning.
- HSTS / OCSP stapling toggles (whatever certbot sets by default — that's what we get).

## 4. UI/UX consistency contract (inherited — non-negotiable)

Same patterns as Slices 1, N, Fs:

- PHOSPHOR tokens, glass cards, ▸-prefix fields (if any), native `<dialog>` confirm, semantic translucent palette, eyebrow labels.
- The SSL chip on a row uses the same shape as the `STATIC` chip from Slice N: `rounded-sm border border-lime-500/30 bg-lime-500/10 px-1.5 py-0.5 font-mono text-[0.55rem] tracking-wider text-lime-300 uppercase` → `SSL · ON` (with a tiny shield/check from lucide as inline icon if it fits).
- The "Enable SSL" button when off: subtle ghost button next to the existing pencil/trash, with a `Lock` icon and "+ SSL" label on hover (tooltip).
- Dialog when enabling: warning banner (amber) about "DNS must already resolve to this server" + a code block previewing the exact certbot command we're about to run (transparency).
- Dialog when disabling: red destructive variant (same shape as delete-vhost dialog).
- Streaming certbot output: pre-formatted `bg-black/40 font-mono text-[0.7rem] text-lime-200/80` inside the dialog, updated via Server-Sent Events... actually wait — SSE is heavy for this slice. **Decision:** capture certbot stdout/stderr on the server, return all of it in `ActionResult.output: string` after the operation completes, display in the dialog after the pending state ends. NOT live-streamed; just shown at the end. Simpler.

## 5. Data model

The `domains.sslEnabled` boolean already exists in the schema from Slice 1. No migration. We also add `updatedAt` set when toggling SSL state (consistency with existing rename op).

## 6. SSL service (`lib/nginx/ssl.ts`)

```ts
export type SslResult = { ok: true; output: string } | { ok: false; error: string; output: string };

function buildEnableArgv(domain: string, email: string, dryRun: boolean): string[] { ... }

export async function enableSsl(domain: string): Promise<SslResult>;
export async function disableSsl(domain: string): Promise<SslResult>;
```

### `buildEnableArgv` (pure, TDD)
```ts
const argv = [
  "certbot", "--nginx",
  "--non-interactive", "--agree-tos",
  "-m", email,
  "-d", domain,
  "--redirect",                 // auto add :80 → :443 redirect
];
if (dryRun) argv.push("--dry-run");
return argv;
```

### `enableSsl(domain)`
1. Read `LETS_ENCRYPT_EMAIL` / `CERTBOT_DRY_RUN` from env. Email missing → return `{ ok: false, error: "LETS_ENCRYPT_EMAIL must be set", output: "" }`.
2. Pre-check: the vhost conf must exist (`/etc/nginx/sites-available/<domain>.conf`). If not, return `{ ok: false, error: "domain not provisioned", output: "" }`.
3. Run `runOnTarget(buildEnableArgv(...))`. Capture full stdout + stderr.
4. If success: `runOnTarget(["nginx", "-t"])` (sanity — certbot just edited the conf), then `nginx -s reload`. Return `{ ok: true, output }`.
5. If failure: leave nginx alone (certbot rolled back its own changes if it failed mid-flight; we don't re-render the vhost). Return `{ ok: false, error: stderr-tail, output }`.

### `disableSsl(domain)`
1. `runOnTarget(["certbot", "delete", "--cert-name", domain, "--non-interactive"])`. Capture output.
2. Re-render the HTTP-only vhost: call `applyVhost(domain)` from `lib/nginx/vhost.ts` — that already writes the conf + reloads nginx, replacing certbot's SSL-version of the conf.
3. Return `{ ok: true, output }` or the failure shape.

> **Why call `applyVhost` for disable:** `certbot delete` removes the cert files and the `--cert-name` config entry, but the vhost conf in `sites-available/` still has certbot's SSL-modified content (it edited the file in place). Calling `applyVhost` re-renders it back to the canonical HTTP-only template. This is the cheapest way to get back to a clean state.

## 7. Server actions (`app/(dashboard)/domains/actions.ts` — extending the existing file)

Add to the existing actions:

- `enableDomainSsl(_prev, formData)` — `{ id }` → load row → validateDomain (defensive) → `enableSsl(domain)` → on success: `db.update(...).set({ sslEnabled: true, updatedAt: new Date() })` → `logActivity("domain_ssl_enable", domain)` → return ok + output.
- `disableDomainSsl(_prev, formData)` — same shape; `logActivity("domain_ssl_disable", domain)`.

Return type extends `ActionResult` to include `output?: string` for the certbot capture (UI shows in the dialog).

## 8. UI

### `components/domains/domain-row.tsx` (modify)

Add to the row:
- If `row.sslEnabled`: replace the `STATIC` chip with two chips: `STATIC` + `SSL · ON` (lime). Add a "disable SSL" item to the action menu... actually, since the row currently has flat icons (pencil/trash), keep it flat:
  - SSL-on state: `STATIC` chip + `SSL` chip + Pencil + Trash. Add a fourth icon: `ShieldOff` (lucide) → opens the disable dialog.
  - SSL-off state: `STATIC` chip + Pencil + Trash + `+ ENABLE SSL` button (small, lime border, with `Shield` icon + text label visible on desktop, icon-only on mobile).

### `components/domains/enable-ssl-dialog.tsx` (NEW)

Pattern: native `<dialog>`, `useActionState(enableDomainSsl, ...)`.

```
eyebrow: vhost · enable ssl
title:   enable SSL?
body:
  warning banner (amber):
    "DNS untuk <domain> harus sudah resolve ke server ini.
     Pastikan A record-nya benar — kalau belum, certbot
     bakal gagal HTTP-01 challenge dan SSL ngga keluar."
  command preview (mono code block):
    "certbot --nginx -n --agree-tos -m <email> -d <domain> [--dry-run]"
buttons: Cancel ghost / Enable SSL lime accent-glow
```

On submit: dialog stays open while pending, shows `[ ·· ] issuing cert (10–30s)`. When done, replaces the buttons row with either:
- success: emerald banner "SSL enabled" + a `<pre>` of the (truncated) certbot output + a single "Done" button to close.
- failure: red banner with the error line + the FULL certbot output in a `<pre>` so the user can debug. Buttons: "Close" + a hint about common issues (DNS, rate limit).

### `components/domains/disable-ssl-dialog.tsx` (NEW)

Same shape, red destructive variant.

```
eyebrow: vhost · disable ssl
title:   disable SSL?
body:
  domain · <domain>
  destructive note: "Cert akan dihapus, vhost balik ke HTTP-only."
buttons: Cancel ghost / Disable SSL red destructive
```

### `components/domains/domain-row.tsx` — action menu

Two dialogs are siblings to `DeleteDialog` inside the row. Each has its own `useRef<DialogHandle>` and the buttons trigger `.current?.open()`.

## 9. Failure semantics

- **Email missing:** server action returns error immediately, no certbot invocation.
- **Domain not provisioned:** server action returns error immediately.
- **DNS not resolving:** certbot's HTTP-01 challenge fails → captured output → red banner with the certbot error verbatim. DB flag stays false.
- **Rate limit hit:** certbot says so explicitly in stderr → surfaced in banner. (Five duplicate certs / week per registered domain in Let's Encrypt prod.)
- **nginx -t fails after certbot:** SHOULD never happen (certbot validates internally), but if it does: report the stderr + leave the vhost in whatever state certbot left it. DB flag stays false.
- **Disable when cert doesn't exist:** `certbot delete` is idempotent-ish — if no cert, it errors. Treat as success (UI shows "no cert to remove" + still re-applies the HTTP vhost).

## 10. Security

- Domain validated via `validateDomain` from Slice N before reaching `enableSsl` (defense in depth — caller already validates).
- All args via `runOnTarget` argv arrays — `domain` and `email` interpolated as discrete args, never shell-strings.
- `LETS_ENCRYPT_EMAIL` is loaded from env, not user input — no injection vector via that arg.
- `certbot --cert-name <domain>` uses domain (already strict-validated). No path traversal possible because certbot itself stores certs at canonical paths under `/etc/letsencrypt/live/<domain>/`.
- The route handler that serves the panel UI is HTTPS-gated by the panel's OWN nginx vhost (`DEPLOY.md` §7). Not this slice's concern.

## 11. Dev/prod parity

- Dev: `CERTBOT_DRY_RUN=true` → certbot does the HTTP-01 dance but doesn't issue a real cert. Output is captured the same way. After a successful dry-run, **we do NOT flip `sslEnabled = true` in the DB** — dry-run isn't a real enable. UI banner says "dry-run successful (dev mode) — no cert installed." 
  - Decision: dry-run returns `{ ok: true, output, dryRun: true }`; UI shows a different success state ("dry-run ok") and SKIPS the DB update. User sees the flow works without state pollution.
- Prod: `CERTBOT_DRY_RUN=false` → real cert, real DB flip, real audit event.

## 12. Tests

- `buildEnableArgv` — unit, TDD. Cases: email + domain + dry-run false → no `--dry-run`. With dry-run true → has it. Email with `+` in it → preserved (don't URL-encode). Domain `foo.bar.com` → unchanged.
- `enableSsl` / `disableSsl` — integration against the live container with `CERTBOT_DRY_RUN=true`. Provision a `qa-ssl-test.localdomain` vhost via Slice N's `applyVhost` first. Verify the dry-run completes successfully + nginx still ok afterwards. Note: dry-run may still fail in the dev container because the test domain doesn't resolve — that's the right failure mode to test (banner shows certbot stderr).
- Server actions — auth gate (401), email missing → friendly error, domain not provisioned → friendly error, mocked-service success path.
- Playwright e2e (using `--dry-run`):
  - Login → /domains → add `qa-ssl-test.localdomain` → click "+ ENABLE SSL" button → confirm dialog → click "Enable SSL" → wait for completion → expect either: (a) "dry-run ok" banner if certbot can simulate, OR (b) red banner with DNS-related certbot error if it can't reach the domain. Both are valid signals that the slice works.
- Mobile QA at 390 px.

## 13. Acceptance criteria

1. Unauthenticated request to either SSL server action → 401 / redirect.
2. `+ ENABLE SSL` button visible on rows where `sslEnabled = false`; SSL chip visible where true.
3. Enable dialog: shows the exact command preview + DNS warning. Cancel closes without firing certbot.
4. Successful enable (prod): cert installed (visible in `/etc/letsencrypt/live/<domain>/`), DB flag flips, audit event, chip appears on next render.
5. Successful disable: cert removed (`certbot certificates` no longer lists it), vhost re-rendered as HTTP-only, DB flag flips, audit event, `+ ENABLE SSL` button reappears.
6. Failure (DNS, rate limit, etc.): captured certbot stderr in the dialog, DB unchanged.
7. Dev dry-run: completes without modifying DB or installing a cert; UI shows the "dry-run ok" state.
8. PHOSPHOR styling correct at 390 px and desktop.
9. Activity log captures `domain_ssl_enable` / `domain_ssl_disable`.
10. `LETS_ENCRYPT_EMAIL` missing → server action returns friendly error, no certbot invoked.

## 14. Project structure (additions)

```
lib/nginx/ssl.ts                           # NEW (+ .test.ts) — argv builder + enable/disable
app/(dashboard)/domains/actions.ts         # MODIFY — add enableDomainSsl + disableDomainSsl
components/domains/domain-row.tsx          # MODIFY — SSL chip + +ENABLE SSL button + ShieldOff disable trigger
components/domains/enable-ssl-dialog.tsx   # NEW (client, native <dialog>)
components/domains/disable-ssl-dialog.tsx  # NEW (client, native <dialog>)
.env.example                               # MODIFY — add LETS_ENCRYPT_EMAIL + CERTBOT_DRY_RUN
.env.production.example                    # MODIFY — same
DEPLOY.md                                  # MODIFY — note CERTBOT_DRY_RUN=false + LETS_ENCRYPT_EMAIL in §3
```

## 15. Dependencies

None new. Reuse `runOnTarget`, `applyVhost`, `validateDomain`, audit, PHOSPHOR utilities, existing dialog pattern.

## 16. Notes / gotchas

- **`certbot --nginx`** modifies the vhost conf file directly. After it runs, the conf is no longer the verbatim template `renderConfig` would produce — it has certbot's SSL block. This is fine; `disableSsl` calls `applyVhost` which overwrites with the template again. As long as we never CALL `applyVhost` while SSL is enabled (e.g., during a rename), state stays consistent.
- **Rename-while-SSL-enabled** is currently a footgun: `renameVhost` calls `applyVhost(new)` which overwrites the certbot-edited conf with the plain template, breaking SSL until the user re-enables. **Acceptable for v1** — flag in the rename dialog: "renaming will disable SSL; you'll need to re-enable on the new domain." UI work for that warning is a polish follow-up.
- **`certbot --non-interactive` requires `--agree-tos` + `-m <email>`** — both supplied. If `--agree-tos` is missing, certbot refuses to run non-interactively.
- **Dry-run output looks similar to real run.** The success detector is the exit code from `runOnTarget`, not parsing stdout. Don't grep certbot output for "successfully" — fragile.
- **First-time certbot setup** in the dev container: certbot stores ACME account state under `/etc/letsencrypt/accounts/` — the dev container is ephemeral, so the first dry-run from a fresh container will register a new staging account. That's fine, just a few extra seconds the first time.
- **Renewal** is certbot's responsibility. Ubuntu installs `/etc/cron.d/certbot` or a systemd timer (`certbot.timer`) by default. We don't touch it.
- **No `--reinstall`** flag — if the user clicks "enable SSL" on a domain that already has a cert (e.g., race / accidental double-click), certbot will detect and exit ok. The server action treats that as success and flips the DB flag (idempotent).

## 17. Follow-ups (later, not this slice)

- Show "expires in N days" on the SSL chip (read from `/etc/letsencrypt/live/<domain>/cert.pem` notAfter).
- Warn before rename when SSL is enabled (and offer to re-enable post-rename automatically).
- Multi-domain certs (`-d foo -d www.foo`).
- Wildcard via DNS-01.
- Manual renewal trigger button (defensive — certbot's auto-renew is reliable).
