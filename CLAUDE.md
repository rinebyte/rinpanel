# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**rinpanel** — a self-hosted web hosting control panel (think aaPanel / cPanel), built as a Next.js fullstack app. It manages a Linux server: Nginx virtual hosts, a file manager, SSL via Let's Encrypt/Certbot, and CPU/RAM/disk monitoring.

**Status: greenfield.** Only the two planning docs below exist so far — the app has not been scaffolded yet. Treat these docs as the source of truth:
- `init.md` — canonical setup/build guide (in Indonesian): stack, scaffold command, Docker, DB schema, dev workflow, build order. **Read this before scaffolding.**
- `design.md` — the **PHOSPHOR** design system, copy-paste exact. **Read this before writing any UI.**

## Stack

- **Next.js latest, App Router**, TypeScript, Tailwind (v4), ESLint — scaffolded via `create-next-app` with `--app --no-src-dir --import-alias "@/*"`.
- **DB:** SQLite via **Drizzle ORM** + `better-sqlite3` (migrations with `drizzle-kit`).
- **Auth:** **NextAuth.js v5** (`next-auth@beta`) — every `app/api` system route must be auth-protected.
- **Shell execution:** Node `child_process`, plus `node-pty`.
- **Dev Linux environment:** Docker (Ubuntu 22.04 + Nginx + Certbot), container name `panel-server`.
- UI deps: shadcn (Base UI variant), `lucide-react`, `clsx`, `zod`.

## Core architecture

The defining seam is **how shell commands reach the server it manages** (`lib/shell.ts`):
- `runCommand()` runs a command on the host directly.
- `runInContainer()` wraps it in `docker exec panel-server …` for local dev on Mac.
- The `USE_DOCKER` env var toggles which target is used. **In dev, the panel drives a Docker container; in production it runs directly on the VPS with sudo/root.** Any feature that touches Nginx, the filesystem, or certbot flows through this abstraction — keep new system operations behind it rather than calling `exec` ad hoc.

Other structural facts:
- **DB schema** (`db/schema.ts`): `users`, `domains` (domain, rootPath, sslEnabled), `activityLogs`. UUID text PKs, integer timestamp/boolean columns.
- **API routes** (`app/api/`): `auth/[...nextauth]`, `nginx`, `files`, `ssl`, `system`. These are the privileged surface.
- **Dev port mapping** (docker-compose): `2222→22` (SSH), `8080→80` (HTTP), `8443→443` (HTTPS). Next.js dev server is on `:3000`.
- **Build order** (per `init.md`): auth → dashboard/monitoring → domain+Nginx → file manager → SSL.

> **Security is the central concern, not a footnote.** This app executes shell commands derived from HTTP input and needs root in production. Validate/escape every input that reaches `lib/shell.ts` (the example helpers in `init.md` interpolate raw strings — do not ship that pattern), and confirm auth on every system route before it does anything.

## Commands

The app isn't scaffolded yet; these come from `init.md` and will apply once it is.

```bash
# Scaffold (run once, into this directory)
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"

# Dev: start the Linux container, then the Next.js app
docker-compose up -d        # boots panel-server (Nginx/Certbot/SSH)
npm run dev                 # Next.js on http://localhost:3000

npm run build               # production build
npm run lint                # ESLint

# Database (Drizzle + SQLite)
npx drizzle-kit push        # apply schema to panel.db
```

## UI / design — PHOSPHOR

`design.md` is authoritative; do not restate it from memory. Load-bearing rules:
- **Dark-only.** Void-black canvas, **one** brand accent = lime phosphor `#84cc16`. Never add a second brand hue.
- **All data in monospace** (Geist Mono): numbers, domains, codes, labels, timestamps, status. Body = Geist; display/titles = Chakra Petch. Avoid Inter / Space Grotesk.
- **Tailwind v4 + shadcn Base UI variant (NOT Radix)** — component APIs (Tooltip `delay`, Badge `render`, Tabs/Sheet/Progress) differ from Radix.
- Frosted-glass panels over a masked blueprint grid; semantic colors always translucent (`-400` text · `/10` fill · `/30` border).
- **Mobile-first** — verify layouts at 390px. Visual-QA in a browser (Python Playwright + Chromium are installed) before claiming a UI task done.
- Gotchas: don't combine `.scan-sweep` + `.corner-ticks` on one element; reference the `next/font` var (`var(--font-geist-mono)`) directly in raw CSS, not `var(--font-mono)`; never name a route/preview folder with a leading underscore (App Router treats `_foo` as private → 404).

## Deployment notes

- Production target is a **VPS the panel runs on directly** (not shared hosting), with sudo/root for Nginx/SSL management. The Docker container is a dev-only stand-in for that VPS.
- This directory is its own git repository; remote: `https://github.com/rinebyte/rinpanel.git`. The surrounding `/Users/nath` home directory is a separate, unrelated git repo — ignore its commit history (e.g. `rineasy*`).
