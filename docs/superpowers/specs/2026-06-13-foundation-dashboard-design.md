# rinpanel — Slice 1: Foundation + Dashboard (Design Spec)

- **Date:** 2026-06-13
- **Status:** Approved (brainstorm) → ready for implementation plan
- **Repo:** github.com/rinebyte/rinpanel
- **Authoritative companions:** `init.md` (build guide), `design.md` (PHOSPHOR design system), `CLAUDE.md`

## 1. Context & goal

rinpanel is a self-hosted web hosting control panel (aaPanel/cPanel-like) that manages a Linux server — Nginx vhosts, files, SSL, and monitoring — through a Next.js fullstack app. The full product is five loosely-coupled subsystems on a shared foundation:

| | Sub-project | Depends on |
|---|---|---|
| **F** | Foundation (scaffold, Docker box, DB, auth, app shell, shell-exec seam) | — |
| **M** | Monitoring / Dashboard | F |
| **N** | Domains & Nginx | F |
| **Fs** | File manager | F |
| **S** | SSL (certbot) | F, N |

Build order: **F → M → N → Fs → S**, each its own spec → plan → build cycle.

**This spec covers the first slice: F + M combined as a vertical slice.** The goal is to prove the riskiest path end-to-end — auth → protected route → shell command into the Linux box → live data → PHOSPHOR UI — and ship a demoable page, rather than plumbing with no visible payoff.

## 2. Decisions locked during brainstorming

1. **First slice = Foundation + Dashboard** (vertical slice, not foundation-only).
2. **Auth = single admin.** One operator account, Credentials login + JWT session, no user-management UI. The `users` table holds a single seeded row.
3. **Docker box now.** Build the real Ubuntu `panel-server` container as part of this slice; the dashboard reads real telemetry via `docker exec`. (macOS host can't serve `free`/`/proc`, so the container is what makes the slice real.)
4. **Telemetry transport = polling.** Client polls a metrics route every ~3s. SSE/WebSocket explicitly deferred; the route is stateless and the design leaves a clean upgrade path.

## 3. Scope

**In scope**
- Next.js scaffold (App Router, TypeScript, Tailwind v4, ESLint), shadcn (Base UI variant), PHOSPHOR tokens/fonts/utilities wired into `globals.css` + `layout.tsx`.
- Docker dev environment: `panel-server` (Ubuntu 22.04 + Nginx + Certbot + SSH) per `init.md`, `docker-compose.yml`, port map `2222:22 / 8080:80 / 8443:443`, volumes for www + nginx config.
- DB layer: Drizzle + better-sqlite3, schema (`users`, `domains`, `activityLogs`), `drizzle-kit push`, seed script.
- Auth: NextAuth v5 Credentials + JWT, split config (edge-safe `auth.config.ts` + Node `auth.ts`), `middleware.ts` route protection, `/login` page, single-admin bootstrap via seed.
- App shell: PHOSPHOR sidebar + layout (collapsing rail, logo, mono nav, live status dot), per `design.md`.
- Dashboard page: live CPU %, memory, disk, load average, uptime, hostname, and a recent activity-log feed; polling ~3s.
- `lib/shell.ts` execution seam + `lib/system/{metrics,activity}.ts` services.
- Tests: parser unit tests, metrics-route auth test, auth/middleware tests; Playwright visual QA.

**Out of scope (later slices)**
- Nginx/domain CRUD, file manager, SSL/certbot operations, interactive terminal/PTY (`node-pty` deferred), multi-user/roles, rate limiting, alerting/history/charts over time.

## 4. Architecture

Strict layering — **the UI never calls `exec` directly**; everything funnels through the shell seam:

```
UI (App Router)
  (auth)/login            ← client form → server action → signIn('credentials')
  (dashboard)/layout      ← Server Component; PHOSPHOR shell; auth-gated
  (dashboard)/page        ← Server Component shell + <LiveDashboard/> client island
        │
API (route handlers, Node runtime)
  api/auth/[...nextauth]  ← re-exports handlers from auth.ts
  api/system/metrics      ← GET, session-checked → getMetrics()
        │
Services
  lib/system/metrics.ts   ← command builders + pure parsers → SystemMetrics
  lib/system/activity.ts  ← logActivity(), getRecentActivity()
        │
Execution seam
  lib/shell.ts            ← runCommand(argv) | runInContainer(argv); USE_DOCKER toggles
        │
Linux box
  dev: docker exec panel-server …     prod: same commands on the host
```

**Production parity:** switching from the dev container to a real VPS is flipping `USE_DOCKER=false` — `runCommand` then executes the identical commands on the host. No service or UI code changes.

## 5. Data model (Drizzle / SQLite)

Per `init.md`, with timestamps as integer epoch and text UUID PKs:

- **users**: `id` (uuid pk), `username` (unique, notNull), `passwordHash` (notNull), `createdAt`.
- **domains**: `id`, `domain` (unique), `rootPath`, `sslEnabled` (bool, default false), `createdAt`. *(defined now for later slices; unused by the dashboard)*
- **activityLogs**: `id`, `action` (notNull), `detail` (nullable), `createdAt`.

> Note: `init.md` names the column `password`; we store a bcrypt hash, so the column is named `passwordHash` to be explicit. DB file: `./panel.db`.

## 6. Auth

- **Provider:** Credentials (username + password). `authorize()` looks up the `users` row and verifies with **bcryptjs** (pure-JS, no native build). Returns the user or `null`.
- **Session:** JWT strategy (no DB session table). Single-admin, so no roles in the token beyond the user id/username.
- **Split config (NextAuth v5 standard pattern):**
  - `auth.config.ts` — edge-safe: `pages.signIn = '/login'`, an empty/declared providers array, and the `authorized` callback for route protection. **No bcrypt/db imports** (so middleware stays edge-bundlable).
  - `auth.ts` — `NextAuth({ ...authConfig, providers: [Credentials({ authorize })] })`; `authorize` imports db + bcryptjs (Node-only). Exports `handlers, auth, signIn, signOut`.
  - `middleware.ts` — `NextAuth(authConfig).auth` as middleware; `matcher` covers `(dashboard)` routes and `/api/system/:path*`. Unauthenticated → redirect `/login`; authenticated on `/login` → redirect dashboard.
- **Env name:** NextAuth v5 uses `AUTH_SECRET` (not the v4 `NEXTAUTH_SECRET` in `init.md`).
- **Admin bootstrap:** `db/seed.ts` reads `ADMIN_USERNAME` / `ADMIN_PASSWORD`, hashes the password, upserts a single user. Idempotent; documented in README/CLAUDE. Run after `drizzle-kit push`.
- **Login UX:** client form (PHOSPHOR command-bar input style) → server action wrapping `signIn`. Generic "invalid credentials" message (no user enumeration). Login success/failure recorded via `logActivity`.

## 7. Dashboard & metrics

**Commands (run in the container; all reads, no user input):**

| Metric | Source | Parse |
|---|---|---|
| CPU % | `/proc/stat` sampled twice ~250ms apart (single `bash -c "cat /proc/stat; sleep 0.25; cat /proc/stat"`) | busy-delta ÷ total-delta × 100 |
| Memory | `free -m` → `Mem:` line | total, used, available; `usagePct = (total-available)/total` |
| Disk | `df -P -BK /` | size/used/avail (KB), `usagePct`, mount |
| Load | `/proc/loadavg` | 1/5/15-min averages |
| Uptime | `/proc/uptime` | seconds (first field) |
| Hostname | `hostname` | trimmed string |

Independent reads run in parallel via `Promise.all`. The CPU two-sample read adds ~250ms latency to a tick — acceptable at a 3s interval.

**Types (shape, refine in impl):**
```ts
interface SystemMetrics {
  cpu: { usagePct: number } | null
  memory: { totalMb: number; usedMb: number; availMb: number; usagePct: number } | null
  disk: { mount: string; sizeKb: number; usedKb: number; availKb: number; usagePct: number } | null
  load: { one: number; five: number; fifteen: number } | null
  uptimeSec: number | null
  hostname: string | null
  errors: string[]   // human-readable per-read failures
  ts: number         // server epoch ms
}
```

**Transport:** `GET /api/system/metrics` (Node runtime, session-checked). Client island `<LiveDashboard/>` polls via a small `usePolling(url, 3000)` hook (useEffect + setInterval + AbortController; no SWR dependency). Pulsing lime status dot = connected; flips to amber/red when a fetch fails or `errors[]` is non-empty.

**UI:** PHOSPHOR stat tiles + gauges per `design.md` §8 (eyebrow labels, mono values, semantic color ramp for usage %: ≥80 red, ≥60 amber/orange, else emerald/lime). Activity feed shows the last 20 entries via `getRecentActivity(20)`, rendered with the telemetry-log recipe (mono lines under a left guide rail). Mobile-first; verify at 390px.

## 8. Error handling

- `lib/shell.ts` returns `{ stdout, stderr, success }` and **never throws** to callers.
- A failed sub-read does not fail the tick: that metric is `null` and a message is pushed to `errors[]`. The dashboard renders partial data.
- Container down / Docker not running → all reads fail → route returns `200` with all-null + `errors` → dashboard shows a red "Linux box unreachable" banner (PHOSPHOR semantic), not a crash.
- `/api/system/metrics` returns `401` when unauthenticated.
- Login failures return a generic error; never reveal whether the username exists.

## 9. Security

- **No user input reaches the shell in this slice** — every command is fixed and hard-coded, so the injection surface is nil here.
- **But** `lib/shell.ts` is built from day one to accept an **argv array** (command + discrete args), executed without a shell where possible (`execFile`/spawn-style) or with strict escaping — so the later slices that *do* take user input (domain names, file paths, cert domains) inherit a safe-by-construction pattern instead of string-interpolating into `bash -c`. This deliberately diverges from the illustrative `exec(\`docker exec … bash -c "${command}"\`)` in `init.md`.
- Dev container SSH/root password (`init.md`) is dev-only; not used by this slice (telemetry uses `docker exec`) and must never carry to prod.
- All system routes are auth-gated by middleware before doing anything.

## 10. Testing

- **Parsers** (`lib/system/metrics.ts`): pure functions, TDD against captured real-output fixtures (`free -m`, `df`, `/proc/stat`, `/proc/loadavg`, `/proc/uptime`). No Docker needed. Primary correctness surface.
- **Shell seam**: integration test — `runInContainer(['echo','ok'])` returns `success:true` when the container is up; skipped if Docker absent.
- **Metrics route**: `401` unauthenticated; shaped JSON authenticated with the shell seam mocked; partial-with-`errors` when a read fails.
- **Auth**: bcrypt verify (good/bad password); middleware redirect (protected route unauth → `/login`).
- **Test runner:** Vitest.
- **Manual visual QA:** Playwright (Python + Chromium, installed) — login → dashboard at 390px and desktop; confirm PHOSPHOR styling and that values refresh ~every 3s; capture screenshots before declaring done.

## 11. Acceptance criteria

1. Logged-out request to any `(dashboard)` route or `/api/system/metrics` → redirect/401.
2. Seeded admin logs in with valid creds; invalid creds show a generic error.
3. Dashboard displays live CPU %, memory, disk, load, uptime, hostname from the container, refreshing ~every 3s.
4. Stopping `panel-server` shows a red "unreachable" state with no crash; restarting recovers automatically.
5. Parser unit tests pass; metrics route returns 401 unauthenticated.
6. Renders per PHOSPHOR (dark, lime accent, mono data) correctly at 390px and desktop.

## 12. Project structure (end state of this slice)

```
app/
  (auth)/login/page.tsx
  (dashboard)/layout.tsx          # PHOSPHOR shell, auth-gated
  (dashboard)/page.tsx            # dashboard + <LiveDashboard/> island
  api/auth/[...nextauth]/route.ts
  api/system/metrics/route.ts
  layout.tsx                      # fonts (Geist/Geist Mono/Chakra Petch), html.dark
  globals.css                     # PHOSPHOR tokens + utilities
auth.ts            auth.config.ts            middleware.ts
db/{index,schema,seed}.ts         drizzle.config.ts
lib/shell.ts       lib/system/{metrics,activity}.ts
components/…                      # shadcn Base UI + PHOSPHOR pieces (sidebar, stat tile, status dot, activity log)
docker/{Dockerfile,nginx-default.conf}        docker-compose.yml
```

## 13. Dependencies

- Runtime: `next`, `react`, `react-dom`, `drizzle-orm`, `better-sqlite3`, `next-auth@beta`, `bcryptjs`, `zod`, `lucide-react`, `clsx`, `tailwind-merge`.
- Dev: `drizzle-kit`, `@types/better-sqlite3`, `@types/bcryptjs`, `vitest`, TypeScript/ESLint (from scaffold).
- Fonts via `next/font/google`: Geist, Geist Mono, Chakra Petch.
- **Deferred:** `node-pty` (interactive terminal — not needed until a later slice).

## 14. Environment variables (`.env.local`)

```
AUTH_SECRET=<random 32+ char>
USE_DOCKER=true
CONTAINER_NAME=panel-server
ADMIN_USERNAME=<admin>
ADMIN_PASSWORD=<strong password, used by seed>
```

## 15. Implementation notes / gotchas

- **Scaffolding into a non-empty dir:** the repo already contains `CLAUDE.md`, `design.md`, `init.md`, `docs/`, `.git`. `create-next-app` refuses non-empty dirs (only whitelists a few files). The plan must handle this — e.g. scaffold into a temp dir and move generated files up, or temporarily relocate the `.md` files + `docs/` during scaffold. Do **not** name any route/preview folder with a leading underscore (App Router treats `_foo` as private → 404; see `design.md` §9).
- **PHOSPHOR fonts in raw CSS:** reference the `next/font` variable directly (`var(--font-geist-mono)`), not `var(--font-mono)` — `@theme inline` may not emit the latter (`design.md` §9).
- **better-sqlite3** is a native module — verify it builds on macOS dev and the prod VPS Node version.
- Keep `next start` on the VPS in the Node runtime so `better-sqlite3`/`bcryptjs`/`child_process` work (they're Node-only, never edge).

## 16. Future slices (not designed here)

M-extras (history/charts), N (domain+Nginx CRUD → config write → reload), Fs (file manager), S (SSL/certbot). Each will reuse the shell seam, auth, and PHOSPHOR shell established here.
