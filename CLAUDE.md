# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**rinpanel** — a self-hosted web hosting control panel (think aaPanel / cPanel), built as a Next.js fullstack app. Manages a Linux server: Nginx vhosts, file manager (later), SSL via Let's Encrypt/Certbot (later), and CPU/RAM/disk monitoring.

**Status:** Slice 1 (Foundation + Dashboard), Polish slice, Slice N (Domains & Nginx), and a Deploy slice have shipped on `main`. Live, runnable. Specs/plans for each slice live in `docs/superpowers/{specs,plans}/`. The remaining roadmap is **Fs (File manager)** and **S (SSL)**.

Authoritative reference docs:
- `design.md` — the **PHOSPHOR** design system. Copy-paste exact. Read before writing any UI.
- `init.md` — the original Indonesian build guide (historical; useful for stack rationale, but specs in `docs/superpowers/specs/` are now the source of truth for shipped slices).
- `DEPLOY.md` — VPS deployment guide.
- `docs/superpowers/specs/*-design.md` — per-slice specs (each lists locked decisions + acceptance criteria).

## Stack

- **Next.js 16** App Router, React 19, TypeScript, **Tailwind v4** (no `tailwind.config.*`, tokens live in `app/globals.css` `@theme inline`).
- **NextAuth v5** (`next-auth@beta`) — single-admin Credentials + JWT, **split-config** pattern.
- **Drizzle ORM** + **better-sqlite3** (sync API); migrations via `drizzle-kit push`.
- **bcryptjs** for password hashing.
- **Docker** (Ubuntu 22.04 + Nginx + Certbot + procps) as the dev Linux target. Container name `panel-server`.
- **Vitest 4** + **Python Playwright** for unit tests / live visual QA.
- **No shadcn install** — hand-rolled PHOSPHOR primitives instead. The visual identity comes from `globals.css` + Tailwind v4 utilities, not from shadcn defaults.

## Core architecture — the two seams

### 1. Shell execution: `lib/shell.ts`

The defining architectural decision. **Every** shell command flows through here.

- `runCommand(argv: string[])` — `execFile` on the host. **No shell** (so user-supplied args can never be shell-interpolated). Returns `{ stdout, stderr, success }`.
- `runInContainer(argv)` — wraps in `docker exec panel-server …` for local dev.
- `runOnTarget(argv)` — what services call: container in dev (`USE_DOCKER=true`), host directly in prod (`USE_DOCKER=false`).

> **Never use `exec(string)` or `bash -c "…"` with anything derived from HTTP input.** The argv-array seam is the security model. New ops go behind it, not around it.

### 2. File writes: `lib/system/target-fs.ts`

- `writeFileOnTarget(path, content)` — `docker cp` to the container in dev, `fs.writeFile` directly in prod. Path is argv-safe (not shell-interpolated); content can be anything.
- Used by the vhost service to write nginx confs and placeholder HTML without bloating the shell seam.

## Next.js 16 conventions

- **`proxy.ts` not `middleware.ts`** — Next 16 renamed the convention. Migrating back will break the build.
- **Split auth config:**
  - `auth.config.ts` is edge-safe (NO db/bcrypt imports) — consumed by `proxy.ts`.
  - `auth.ts` is Node-only (Credentials + db + bcryptjs) — consumed by route handlers + server components.
  - **Don't collapse the split.** It's what keeps the edge bundle clean.
- `force-dynamic` on routes that hit `panel.db` at request time (dashboard, `/domains`).
- React 19 `<form action={fn}>` requires `void` / `Promise<void>` return; server actions returning structured results need an inline `(fd) => { void someAction(fd); }` wrapper when used directly (or `useActionState` when you want the result back).

## PHOSPHOR UI consistency contract (NON-NEGOTIABLE)

Codified from Slices 1 + Polish + N. Every new screen must follow:

| Pattern | Where |
|---|---|
| Hero block: `MODULE 0X · NAME` eyebrow + `font-display` title + status chip/dot | Every primary route |
| `.glass` + `.corner-ticks` cards | Tiles, dialogs, form panels |
| ▸-prefix terminal field (lime caret, `bg-black/40`, lime focus ring) | Every text input |
| Native `<dialog>` confirm modal (CANCEL ghost + LIME or RED action) | Every destructive action (delete, sign-out, etc.) |
| Eyebrow uppercase mono labels | Every kicker / section header |
| Semantic translucent palette: `-400 text / -500/10 bg / -500/30 border` | success=emerald, info=sky, warning=amber, danger=red |
| `animate-glow-pulse` dot | Live / connected / active indicators |
| Mobile-first verify at 390 px via Playwright | Closing QA gate of every slice |

Tokens, fonts, utilities, keyframes all live in `app/globals.css`. Three fonts: Geist (sans), Geist Mono (data/labels), Chakra Petch (display). Reference the `next/font` variables (`var(--font-geist-mono)` etc.) in raw CSS — `var(--font-mono)` may not be emitted by `@theme inline`.

`design.md` has more detail (color tokens, semantic ramp, motion). Don't restate from memory; check the file.

## Commands (dev)

```bash
# First-time setup (after clone)
docker compose up -d          # boot panel-server container (Ubuntu+Nginx+Certbot)
npm install
cp .env.example .env.local    # then edit AUTH_SECRET, ADMIN_*
npm run db:push               # create tables
npm run db:seed               # seed admin user

# Day-to-day
npm run dev                   # Next.js dev on :3000
npm test                      # full Vitest suite
USE_DOCKER=true npm test      # include 3 vhost integration tests (need container up)
npm run build                 # production build
npm run lint
```

Database file is `panel.db` in the repo root; git-ignored.

## Deployment

See **`DEPLOY.md`** for the full VPS guide. TL;DR: clone to `/opt/rinpanel`, install + build, copy `.env.production.example` → `.env.local` (set `USE_DOCKER=false`), `db:push` + `db:seed`, drop `deploy/rinpanel.service` into `/etc/systemd/system/`, drop `deploy/nginx-panel.conf.example` into `/etc/nginx/sites-available/`, certbot for HTTPS. Service runs as root (matches cPanel norm; security boundary = auth + validateDomain, not OS user).

`npm start` binds Next to `127.0.0.1:3000` — direct internet access is closed; everything flows through nginx reverse-proxy in front.

## Shipped slices (for context when extending)

| Slice | What | Key files |
|---|---|---|
| **F + M** (Foundation + Dashboard) | Auth, Docker panel-server box, PHOSPHOR app shell, polling `/api/system/metrics` with CPU/Mem/Disk/Load/Uptime/Hostname + activity log | `lib/shell.ts`, `lib/system/metrics.ts`, `auth.{ts,config.ts}`, `proxy.ts`, `app/(dashboard)/`, `app/(auth)/login/` |
| **Polish** | In-memory IP rate-limit on `/login` (7/10 min sliding window), logout server action + audit, sidebar user badge, logout `<dialog>` confirm, login UI redesign | `lib/auth/rate-limit.ts`, `app/(dashboard)/logout-action.ts`, `components/app-shell/sidebar.tsx` |
| **N** (Domains & Nginx) | Static-only vhost CRUD (list/create/rename/delete), strict `validateDomain` security gate, `vhost.ts` apply/remove/rename with rollback, `writeFileOnTarget` seam, audit | `lib/nginx/{validate,render,vhost}.ts`, `lib/system/target-fs.ts`, `app/(dashboard)/domains/`, `components/domains/` |
| **Deploy** | `DEPLOY.md`, `deploy/rinpanel.service`, `deploy/nginx-panel.conf.example`, `.env.production.example`, `npm start` bound to 127.0.0.1 | this file + `deploy/` + `DEPLOY.md` |

## Things that look like bugs but aren't

- **`nginx -s reload` sleeps 500ms** inside `lib/nginx/vhost.ts::nginxReload()`. nginx's reload signal returns before the new workers finish swapping configs; the sleep prevents test races and curl-too-soon. Worth ~+500ms per CRUD op — fine at single-admin scale.
- **`AGENTS.md` was removed.** The scaffold generated a stub; we deleted it. `CLAUDE.md` (this file) is the canonical agent doc.
- **`bg-sidebar/80` requires the `sidebar` token** — defined in `app/globals.css` (`--sidebar: oklch(...)` + `--color-sidebar: var(--sidebar)` in `@theme inline`). Don't remove either.
- **`activityLogs` row for `domain_delete` includes `(wiped webroot)` suffix when the user opt-in checked the wipe box.** Searchable signal in audit.

## Things to NOT do

- Don't introduce a second brand color. Lime `#84cc16` is the only accent.
- Don't add shadcn primitives now — the PHOSPHOR hand-rolled approach is intentional. Reconsider only if component complexity warrants it.
- Don't make `proxy.ts` import `auth.ts`. Edge bundle stays clean by importing only `auth.config.ts`.
- Don't add fields editable via UI that get interpolated into shell commands without a strict validator at the wire boundary (see `lib/nginx/validate.ts` for the pattern).
- Don't rename a route folder with a leading underscore (App Router treats `_foo` as private → 404).
