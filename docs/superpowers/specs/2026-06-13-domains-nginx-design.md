# rinpanel — Slice N: Domains & Nginx (Design Spec)

- **Date:** 2026-06-13
- **Status:** Approved (brainstorm) → ready for plan
- **Depends on:** Slice 1 (Foundation + Dashboard), Polish slice
- **Sibling docs:** `design.md` (PHOSPHOR), `init.md` (build guide), `CLAUDE.md`, prior specs in `docs/superpowers/specs/`

## 1. Context & goal

Slice N adds vhost (virtual-host) management — list, create, edit (rename), delete — for **static** sites served by Nginx in the `panel-server` Docker container (dev) and directly on the VPS (prod). It is the **first slice where HTTP input touches the shell**, so the validation gate is load-bearing: get it wrong and an attacker can write arbitrary files into `/etc/nginx/sites-available/`.

## 2. Decisions locked during brainstorming

1. **Static-only scope.** No reverse-proxy, no PHP, no custom directives. Each vhost is a vanilla `listen 80 → root /var/www/<domain>/public_html` block. Reverse-proxy and PHP get their own future slices.
2. **Operations:** list + create + delete + edit (rename). No enable/disable toggle.
3. **Webroot derivation:** `/var/www/<domain>/public_html` — always derived from domain, never user-editable. The DB stores it for transparency only.
4. **Default delete behavior:** preserve webroot. Wipe is opt-in via dialog checkbox.
5. **Placeholder content:** every new vhost auto-gets an `index.html` with a small PHOSPHOR-styled "PROVISIONED · `<domain>`" page so curl-ing the domain immediately returns HTTP 200 (also useful for the upcoming SSL slice).
6. **Rename semantics:** `mv /var/www/<old> /var/www/<new>` + apply new conf + remove old conf, with rollback if `nginx -t` fails. While the file-manager slice isn't built yet, webroots only contain the placeholder, so atomic-mv is safe.
7. **API surface:** **server actions only** (form submissions). No REST API routes this slice (we can add curl-able routes in a follow-up if needed; YAGNI). This matches the rest of the app pattern: the dashboard's polling needs an API route, mutation-via-form does not.
8. **Reload timing:** `nginx -s reload` runs synchronously, blocking the server action's response (~50–100 ms — fine at this scale).

## 3. Scope

**In scope**
- DB migration: add `updatedAt` column to `domains` table.
- `lib/nginx/validate.ts` — pure `validateDomain(input)` (the security gate).
- `lib/nginx/render.ts` — pure `renderConfig(domain)` (nginx server-block template) and `renderPlaceholderHtml(domain)`.
- `lib/system/target-fs.ts` — `writeFileOnTarget(path, content)` (USE_DOCKER seam for file writes).
- `lib/nginx/vhost.ts` — `applyVhost`, `removeVhost`, `renameVhost` with rollback semantics.
- Server actions in `app/(dashboard)/domains/actions.ts`.
- Domains page UI (server component + client island), PHOSPHOR-consistent.
- Sidebar `Domains` nav item: enable (currently disabled).
- Tests: TDD unit tests on validators/renderers, integration tests against the live `panel-server` container, Playwright e2e for the full UI flow.

**Out of scope (other slices)**
- Reverse-proxy mode (future N+something).
- PHP-FPM (own slice).
- SSL/Certbot (slice S — depends on N).
- Per-domain log viewer / metrics history.
- Bulk operations, import/export.
- DNS verification (we don't check whether the user's DNS actually points at the box).
- Cross-domain rename atomicity beyond the simple webroot mv described in §10.

## 4. UI/UX consistency contract (NON-NEGOTIABLE — applies to every slice going forward)

This codifies the patterns established in Slice 1 + Polish. Drift from these is a defect.

| Pattern | Where it must appear |
|---|---|
| PHOSPHOR tokens (lime + zinc, dark-only, mono telemetry) | All pages |
| Hero block: `MODULE 0X · NAME` eyebrow + `font-display` title + status chip/dot | Every primary route |
| `.glass` + `.corner-ticks` cards | Stat tiles, dialogs, form panels, list cards |
| ▸-prefix terminal field (lime caret, dark `bg-black/40`, lime focus ring) | Every text input |
| Native `<dialog>` confirm modal (CANCEL ghost + LIME or RED action) | Every destructive action |
| Eyebrow uppercase mono labels | Every kicker / section header |
| Semantic translucent palette: `-400 text / -500/10 bg / -500/30 border` | success=emerald, info=sky, warning=amber, danger=red |
| `animate-glow-pulse` dot | Live / connected / active indicators |
| Mobile-first; verify at 390 px via Playwright | Closing QA gate of every slice |

For this slice specifically: a count chip in the hero ("3 ACTIVE"), a `.glass` table for the list, terminal-style row hover, and the same `<dialog>` pattern as logout for delete confirmation.

## 5. Data model (Drizzle migration)

The `domains` table already exists from Slice 1. Add one column:

```ts
// db/schema.ts (modify domains)
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

Migration applied via `npm run db:push`. `sslEnabled` stays in the schema, unused by this slice.

## 6. Domain validation rules (the security gate)

`validateDomain(input)` returns `{ ok: true } | { ok: false; reason: string }`. Rules:

1. Must be a non-empty string.
2. Max length 253 chars (RFC 1035 maximum).
3. Must be lowercase as supplied (reject mixed-case rather than auto-normalizing — explicit > implicit).
4. Only `[a-z0-9.\-]` characters allowed at the top level (regex `/^[a-z0-9.\-]+$/`).
5. Split on `.` → at least **2** labels (must be FQDN: `example.com`, not just `example`).
6. Each label: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` — non-empty, max 63 chars, alphanumeric edges, hyphens allowed internally.
7. Reject `localhost`.
8. Reject IPv4-shaped strings (`^\d+(\.\d+){3}$`).
9. Reject `..` (multiple consecutive dots).

Why strict-lowercase rather than `toLowerCase()`-in-place: it makes mixed-case inputs visibly fail at the validation boundary instead of silently transforming. The UI auto-lowercases as the user types (display-only sugar), so user friction stays low.

This is the **only** entry point through which a domain string reaches the shell or the filesystem; all other functions can assume their input has already been validated.

## 7. Nginx config template (`renderConfig`)

```nginx
# Generated by rinpanel for <domain>
server {
    listen 80;
    server_name <domain>;
    root /var/www/<domain>/public_html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    access_log /var/log/nginx/<domain>.access.log;
    error_log /var/log/nginx/<domain>.error.log;
}
```

Decisions:
- `try_files $uri $uri/ =404;` (NOT the SPA-fallback `/index.html`) — traditional static serving is the right default; SPA mode can be a future per-domain flag.
- Per-domain access/error logs — useful for the eventual log-viewer slice; also makes prod incidents easier to triage.

A placeholder `index.html` is also rendered by `renderPlaceholderHtml(domain)`: a minimal PHOSPHOR-styled page that shows `PROVISIONED · <domain>` and the timestamp, so curl-ing the domain returns 200 immediately.

## 8. Vhost service (`lib/nginx/vhost.ts`)

All operations funnel through this module. None of them take raw HTTP input — callers validate first with `validateDomain`.

### `applyVhost(domain): Promise<{ ok: true } | { ok: false; error: string }>`

1. `writeFileOnTarget("/etc/nginx/sites-available/<domain>.conf", renderConfig(domain))`
2. `runOnTarget(["mkdir", "-p", "/var/www/<domain>/public_html"])`
3. `writeFileOnTarget("/var/www/<domain>/public_html/index.html", renderPlaceholderHtml(domain))`
4. `runOnTarget(["ln", "-sf", "/etc/nginx/sites-available/<domain>.conf", "/etc/nginx/sites-enabled/<domain>"])`
5. `runOnTarget(["nginx", "-t"])`
6. If OK: `runOnTarget(["nginx", "-s", "reload"])` → `{ ok: true }`
7. If `nginx -t` FAILS: rollback by removing the symlink and the conf only → return `{ ok: false, error: <stderr> }`. (The webroot dir + placeholder are left in place — benign without an active vhost; user can clean up with a subsequent `removeVhost(..., { wipeWebroot: true })` if they want.)

### `removeVhost(domain, { wipeWebroot }): Promise<...>`

1. `runOnTarget(["rm", "-f", "/etc/nginx/sites-enabled/<domain>"])`
2. `runOnTarget(["rm", "-f", "/etc/nginx/sites-available/<domain>.conf"])`
3. If `wipeWebroot`: `runOnTarget(["rm", "-rf", "/var/www/<domain>"])` — and **the caller has already validated the domain**, so the path is safe.
4. `runOnTarget(["nginx", "-t"])` — sanity check after removal (should always pass).
5. `runOnTarget(["nginx", "-s", "reload"])`.

### `renameVhost(oldDomain, newDomain): Promise<...>`

1. Validate both (defensive — caller already did).
2. `runOnTarget(["mv", "/var/www/<oldDomain>", "/var/www/<newDomain>"])`.
3. `writeFileOnTarget("/etc/nginx/sites-available/<newDomain>.conf", renderConfig(newDomain))`.
4. `runOnTarget(["ln", "-sf", "/etc/nginx/sites-available/<newDomain>.conf", "/etc/nginx/sites-enabled/<newDomain>"])`.
5. `runOnTarget(["nginx", "-t"])`.
6. If OK: reload + cleanup old (`rm -f` symlink + conf for oldDomain) → `{ ok: true }`.
7. If FAIL: rollback (`mv` webroot back, remove new conf + symlink) → return error.

> **Security guarantee:** every argv passed to `runOnTarget` is composed from a validated `domain` string (regex-restricted) plus static literal prefixes. **There is no point in this service where a shell is invoked with a user-derived string.** The argv-array seam from Slice 1 carries us.

## 9. File-write strategy (`lib/system/target-fs.ts`)

`writeFileOnTarget(path, content)` writes a file to the **target** (container in dev, host in prod):

- Dev (`USE_DOCKER=true`): write to a `/tmp/rinpanel-<rand>` temp file via Node `fs.writeFile` → `spawn("docker", ["cp", tmp, "<container>:<path>"])` → unlink temp file. `docker cp` takes argv, so the path is shell-safe.
- Prod (`USE_DOCKER=false`): write directly to `path` via Node `fs.writeFile`.

Why not extend `lib/shell.ts` with stdin support: file writes are a distinct concern with their own path-safety semantics; bloating the security-critical shell seam isn't worth it. Keeping `target-fs.ts` separate keeps `shell.ts` focused on "run an argv on the target."

## 10. UI

### Page structure: `app/(dashboard)/domains/page.tsx` (Server Component)

```
<Hero MODULE 02 · DOMAINS> + <count chip: N ACTIVE>
<CreateForm/>             ← client island, server-action create
<DomainsTable rows={...}> ← client island; renders DomainRow per row
<EmptyState/> when no rows
```

### Components

- `components/domains/create-form.tsx` — single ▸-prefix domain input + lime `+ ADD DOMAIN ↵` button. Inline-error banner (semantic red) for `nginx -t` failures or duplicates. Auto-lowercases as user types (display sugar only; server validates strictly).
- `components/domains/domain-row.tsx` — mono `<domain>` + `STATIC` lime-bordered chip + ▸ root path (zinc-500) + action icons (`Pencil` rename, `Trash` delete). Inline rename: clicking the pencil swaps the text with a ▸-prefix input; ENTER saves (server action) / ESC cancels.
- `components/domains/delete-dialog.tsx` — native `<dialog>`, same pattern as logout. Title `delete vhost?`, body shows domain to delete, **checkbox** "Hapus webroot juga? (`/var/www/<domain>`)" (default unchecked → preserve files), CANCEL ghost + DELETE red destructive.

### Sidebar (`components/app-shell/sidebar.tsx`)

Flip the `enabled` flag on the `Domains` nav item from `false` → `true`. The active-pill behavior is already wired.

### Mobile (390 px)

- Hero count chip wraps below the title.
- Create form input + button stack vertically.
- Table → cards (one per domain), action icons remain visible on the right edge.
- Dialog spans `min(22rem, calc(100vw - 2rem))` — same as the logout dialog.

## 11. Failure semantics

- Validation runs **twice** (UI form action and inside `applyVhost`) — defense in depth.
- Every mutation: write/move FS → `nginx -t` → reload **or** rollback. DB row is only created/renamed/deleted **after** the reload succeeds. Result: DB and nginx state are always consistent.
- Idempotency: duplicate domain creation is refused by the DB unique constraint; the server action turns this into a friendly "domain already exists" banner instead of throwing.
- Errors surface verbatim: `nginx -t` stderr lands in the UI banner inside a `font-mono` `bg-black/40` code block, so the user can read what nginx said.

## 12. Tests

- `validateDomain` — unit, TDD. Positive: `example.com`, `sub.deep.example.co`, `a.b`, `123-foo.com`. Negative: `''`, `EXAMPLE.com`, `example`, `localhost`, `192.168.1.1`, `foo..com`, `foo bar.com`, `-foo.com`, `foo-.com`, `<64chars>.com`, `<254chars>`, `foo/bar.com`, `..`.
- `renderConfig` / `renderPlaceholderHtml` — snapshot/fixture compare.
- `target-fs.ts` — unit test on the prod path (no Docker needed). Integration test for the dev path: skip if Docker absent.
- `vhost.ts` — **integration tests against the live `panel-server` container** (vitest, skip if Docker absent). Verify: create → `nginx -t` passes → reload → curl returns 200 from inside the container → rename → curl old returns 404 + new returns 200 → delete → curl returns 404. (HTTP requests via `runOnTarget(["curl", ...])`.)
- Server actions — auth gate (401 unauth), invalid-domain rejection, duplicate handling, success path (mock vhost service).
- Domains page — Playwright e2e: add domain → row appears + curl reachable → rename → row text updates + curl reachable at new name → delete with dialog → row removed → 404.

## 13. Acceptance criteria

1. Unauthenticated request to `/domains` or any of its server actions → redirect/401.
2. Validation rejects mixed-case, `localhost`, IP, special chars, multiple dots, too-long.
3. Creating a valid domain → row appears in UI + `curl -H "Host: <domain>" http://localhost:8080/` returns the placeholder page (200).
4. Renaming the domain → curl new name returns 200; curl old name returns 404.
5. Deleting (default) → row removed; curl returns 404; webroot directory remains on disk.
6. Deleting with "wipe webroot" checkbox → webroot directory also removed.
7. `nginx -t` failure (simulated by injecting a known-bad config in tests) → no reload happens; DB row not created/modified; UI shows the stderr.
8. PHOSPHOR styling correct at 390 px and desktop; sidebar `Domains` item active when on `/domains`.
9. Activity log records `domain_create` / `domain_rename` / `domain_delete` events (consistency with login/logout audit pattern).

## 14. Project structure (additions)

```
db/schema.ts                         # MODIFY: add updatedAt to domains
lib/nginx/validate.ts                # NEW (+ .test.ts)
lib/nginx/render.ts                  # NEW (+ .test.ts)
lib/nginx/vhost.ts                   # NEW (+ .test.ts integration)
lib/system/target-fs.ts              # NEW (+ .test.ts)
app/(dashboard)/domains/page.tsx     # NEW (server)
app/(dashboard)/domains/actions.ts   # NEW (server actions)
components/domains/create-form.tsx   # NEW (client)
components/domains/domain-row.tsx    # NEW (client; inline rename)
components/domains/delete-dialog.tsx # NEW (client; native <dialog>)
components/app-shell/sidebar.tsx     # MODIFY: enable Domains nav item
```

## 15. Dependencies

None new. We reuse `drizzle-orm`, `next-auth@beta`, `zod`, `lucide-react`, existing PHOSPHOR utility classes, the existing `runOnTarget` seam.

## 16. Notes / gotchas

- **Symlink path is `sites-enabled/<domain>` (no `.conf` extension)** — that's the Debian convention and matches the existing `docker/nginx-default.conf`.
- **The current `default_server` (port 80, `server_name _`) in `nginx-default.conf` is unrelated** to per-domain server blocks; it stays as the catch-all for unknown hosts. Don't disable it.
- **Validation is on the wire, NOT in DB constraint.** SQLite's `UNIQUE` check catches duplicates but not malformed strings — the regex IS the source of truth.
- **Reload doesn't drop connections** (`nginx -s reload` performs hot reload); safe even if other vhosts are serving traffic.
- **In prod (USE_DOCKER=false), the Next.js process needs FS write permission to `/etc/nginx/sites-available/` and `/etc/nginx/sites-enabled/`, plus `nginx -t` / `nginx -s reload` capability.** This is a sudoers-config concern flagged in CLAUDE.md and will be addressed in the production-hardening pass; dev runs as `root` inside the container, so we're fine.
- **Audit events** (`domain_create`, `domain_rename`, `domain_delete`) use the existing `logActivity(action, detail)` API — `detail` is the domain (or `oldName → newName` for renames).

## 17. Follow-ups (later slices, not this one)

- REST API routes (`/api/system/domains/...`) for CLI/external automation.
- SPA mode toggle (changes `try_files` to fallback to `/index.html`).
- Reverse-proxy mode + PHP-FPM as their own slices.
- Slice S (SSL) uses `applyVhost`/state from this slice — depends on N.
