# PHOSPHOR — Design System

> A dark, private, terminal-native console aesthetic: **void-black canvas, a single lime-phosphor accent, monospace telemetry, frosted-glass panels, a blueprint grid, and restrained glow.** Built to feel like a piece of classified intelligence equipment — "expensive without being ostentatious."
>
> Reference language: Vercel / Linear / Raycast / Warp / VoltAgent (void-black + emerald, terminal-native) / NOC monitoring consoles. Implemented for the `domain` project (Next.js 16 + Tailwind v4 + shadcn Base UI variant) on 2026-06-11.

Drop this file into a project and a coding agent can reproduce or extend the UI consistently. Values are copy-paste exact.

---

## 1. Philosophy

- **One accent, used surgically.** Lime phosphor (`#84cc16`) is the ONLY brand color. Everything else is void-black + neutral zinc + translucent white. Never introduce a second brand hue.
- **Dark-only.** There is no light mode. The palette lives in `:root`; `<html class="dark">` exists only to engage component `dark:` variants.
- **Data is monospace.** Every number, code, domain, label, timestamp, and status reads in mono. Prose reads in a clean sans. Identity moments (wordmark, page titles, the big score) read in a technical display face.
- **Atmosphere over flat fills.** Surfaces are frosted glass floating over a masked blueprint grid + radial glow + fine grain — never a solid block of color.
- **Telemetry voice.** Micro-labels are uppercase, letter-spaced mono ("eyebrows"). Sections read like a readout: `MODULE 01 · ANALYSIS`, `DOMAIN DOSSIER`, `SESSION · PRIVATE`, `[ OK ]`.
- **Restraint = premium.** Motion is sparse and purposeful (one staggered reveal, a slow scan-sweep, a pulsing status dot). No confetti, no scattered micro-interactions.

---

## 2. Color tokens

OKLCH, with the accent in hex. These are the `:root` custom properties (Tailwind v4 `@theme inline` maps them to `--color-*`).

```css
:root {
  --accent-rgb: 132 204 22;            /* lime, for rgb(var(--accent-rgb)/α) glows */

  --background: oklch(0.145 0.006 256); /* void black, faint cool tint */
  --foreground: oklch(0.93 0.004 247);  /* soft white (not pure #fff) */
  --card: oklch(0.205 0.007 256);       /* elevated surface (glass base) */
  --popover: oklch(0.2 0.007 256);
  --primary: #84cc16;                   /* lime phosphor */
  --primary-foreground: #0a0a0a;        /* black text ON lime */
  --secondary: oklch(0.27 0.007 256);
  --muted: oklch(0.27 0.007 256);
  --muted-foreground: oklch(0.682 0.012 250);
  --accent: oklch(0.3 0.008 256);
  --destructive: oklch(0.62 0.21 24);
  --border: oklch(1 0 0 / 9%);          /* hairline: white @ 9% */
  --input: oklch(1 0 0 / 12%);
  --ring: #84cc16;
  --radius: 0.5rem;                     /* sharp-ish, technical */

  --sidebar: oklch(0.128 0.006 256);    /* rail is darker than canvas */
  --sidebar-accent: oklch(0.24 0.007 256);
  --sidebar-border: oklch(1 0 0 / 8%);
  --sidebar-primary: #84cc16;
  --sidebar-primary-foreground: #0a0a0a;
}
html { color-scheme: dark; }
```

### Neutral text ramp (Tailwind zinc on void-black)

| Role | Class |
|---|---|
| Display headers / emphasis | `text-white` |
| Primary text | `text-zinc-100` |
| Body text | `text-zinc-300` |
| Secondary text | `text-zinc-400` |
| Muted / captions | `text-zinc-500` |
| Faint / disabled | `text-zinc-600` |

### Semantic colors (always translucent on dark)

Pattern: **`-400` text · `/10` fill · `/30` border** (never the light `-50/-600` web defaults).

| Meaning | Text | Fill | Border |
|---|---|---|---|
| Accent / primary | `text-lime-400` | `bg-primary` | `border-lime-500/30` |
| Success / healthy | `text-emerald-400` | `bg-emerald-500/10` | `border-emerald-500/30` |
| Info / branded | `text-sky-400` | `bg-sky-500/10` | `border-sky-500/30` |
| Warning | `text-amber-400` | `bg-amber-500/10` | `border-amber-500/30` |
| Caution | `text-orange-400` | `bg-orange-500/10` | `border-orange-500/30` |
| Danger / spam | `text-red-400` | `bg-red-500/10` | `border-red-500/30` |
| AI / Gemini | `text-violet-300` | `bg-violet-500/10` | `border-violet-500/30` |

Score grade ramp (0–100): `≥80` emerald · `≥60` sky · `≥40` amber · `≥20` orange · `<20` red.

---

## 3. Typography

Three families, loaded via `next/font/google` (all confirmed available):

| Token | Font | Role |
|---|---|---|
| `--font-sans` → `font-sans` | **Geist** (variable) | Body, UI, prose |
| `--font-mono` → `font-mono` | **Geist Mono** (variable) | ALL data: numbers, domains, codes, labels, JSON, timestamps, status |
| `--font-display` / `--font-heading` → `font-display` | **Chakra Petch** (400/500/600/700) | Wordmark, page titles, big score, dossier domain |

```ts
// layout.tsx
const geist = Geist({ subsets:["latin"], variable:"--font-geist", display:"swap" });
const geistMono = Geist_Mono({ subsets:["latin"], variable:"--font-geist-mono", display:"swap" });
const chakra = Chakra_Petch({ subsets:["latin"], weight:["400","500","600","700"], variable:"--font-chakra", display:"swap" });
// <html class={`dark ${geist.variable} ${geistMono.variable} ${chakra.variable}`}>
```

```css
@theme inline {
  --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-display: var(--font-chakra), var(--font-geist), ui-sans-serif, sans-serif;
  --font-heading: var(--font-display);
}
```

- **Avoid** Inter / Roboto / Arial / system fonts and the over-used Space Grotesk.
- Page titles: `font-display text-3xl font-bold tracking-wide text-white`.
- The big score: `font-mono text-7xl font-bold tabular-nums` + a color-matched inline `textShadow` (see §6).

---

## 4. Background system

Three fixed layers behind app content (which sits at `relative z-10`).

```css
body {
  background-image:
    radial-gradient(130% 100% at 50% -8%, rgb(var(--accent-rgb)/0.10) 0%, transparent 46%),
    radial-gradient(90% 70% at 100% 0%, oklch(0.7 0.13 205 / 0.06) 0%, transparent 42%);
  background-attachment: fixed;
}
/* Blueprint grid — masked to fade toward the bottom */
body::before {
  content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
  background-image:
    linear-gradient(to right, color-mix(in oklch, var(--foreground) 4%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklch, var(--foreground) 4%, transparent) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(125% 100% at 50% 0%, black 0%, transparent 72%);
}
/* Fine grain — analog texture */
body::after {
  content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
  opacity:0.025; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,...feTurbulence baseFrequency=0.9...");
}
```

Also: thin technical scrollbars (`scrollbar-width:thin`, white @ ~13%), lime selection (`::selection { background: rgb(var(--accent-rgb)/0.3) }`).

---

## 5. Surfaces & glass

All panels are frosted glass. The shadcn `Card` primitive carries it globally:

```
bg-card/70 backdrop-blur-xl backdrop-saturate-150 ring-1 ring-white/10
shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_24px_60px_-30px_rgba(0,0,0,0.85)]
rounded-xl overflow-hidden
```

- Hairlines are **`border-white/10`** (or token `border-border`), never opaque gray.
- Inset tiles / sub-surfaces: `bg-white/[0.03]` or `bg-white/5` + `border-white/10`.
- Table rows: `border-white/5 hover:bg-white/5`; header row `border-white/10 hover:bg-transparent`, head cells `text-zinc-500`.

---

## 6. Signature utilities

Defined in `globals.css`. Reusable across components.

```css
@layer components {
  .glass { background: color-mix(in oklch, var(--card) 70%, transparent);
           backdrop-filter: blur(16px) saturate(1.35); border: 1px solid var(--border); }

  /* Telemetry micro-label */
  .eyebrow { font-family: var(--font-geist-mono), ui-monospace, monospace;
             font-size: 0.625rem; line-height: 1; letter-spacing: 0.22em;
             text-transform: uppercase; color: var(--muted-foreground); }

  .text-glow  { text-shadow: 0 0 18px rgb(var(--accent-rgb)/0.55), 0 0 4px rgb(var(--accent-rgb)/0.4); }
  .accent-glow{ box-shadow: 0 0 0 1px rgb(var(--accent-rgb)/0.35), 0 8px 30px -10px rgb(var(--accent-rgb)/0.5); }

  /* Registration ticks (top-left + bottom-right) — uses ::before AND ::after */
  .corner-ticks::before, .corner-ticks::after { content:""; position:absolute; width:10px; height:10px;
    pointer-events:none; border-color: rgb(var(--accent-rgb)/0.5); }
  .corner-ticks::before { top:10px; left:10px; border-top:1px solid; border-left:1px solid; }
  .corner-ticks::after  { bottom:10px; right:10px; border-bottom:1px solid; border-right:1px solid; }

  /* Slow scan line for hero/active panels — uses ::after */
  .scan-sweep { position:relative; overflow:hidden; }
  .scan-sweep::after { content:""; position:absolute; inset-inline:0; top:0; height:36%;
    background: linear-gradient(to bottom, transparent, rgb(var(--accent-rgb)/0.06), transparent);
    animation: scan-sweep 5s linear infinite; pointer-events:none; }
}
```

> **GOTCHA:** `.scan-sweep` and `.corner-ticks` BOTH define `::after`. Never put both classes on the same element — they collide (only one `::after` exists). Put `scan-sweep` on the outer panel and `corner-ticks` on an inner `relative` child (or vice-versa). The score-card does this.

Usage:
- `.eyebrow` for every section label / page kicker. Override color with `text-zinc-600` etc. (utilities win over the component layer).
- `.accent-glow` on the primary CTA, the sidebar logo, and active emphasis.
- `.text-glow` / inline `textShadow` for glowing numerals. The big score uses a **grade-colored** glow: `style={{ textShadow:`0 0 28px ${hex}55, 0 0 8px ${hex}40` }}` so a red score glows red, an emerald score glows green.

---

## 7. Motion

```css
@keyframes reveal     { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:none } }
@keyframes scan-sweep { 0% { transform:translateY(-120%) } 100% { transform:translateY(420%) } }
@keyframes glow-pulse { 0%,100% { opacity:.45 } 50% { opacity:1 } }
@keyframes blink      { 0%,100% { opacity:1 } 50% { opacity:.2 } }
```
Utilities: `.animate-reveal` (0.55s, `cubic-bezier(.2,.7,.2,1)`, one-shot on result panels) · `.animate-glow-pulse` (status dots) · `.animate-blink` (live `[ ·· ]` cursor). All wrapped in a `prefers-reduced-motion: reduce` kill-switch.

- One **staggered reveal** on the main result is enough drama.
- The **scan-sweep** belongs only on hero/active panels (dossier, running telemetry).
- A **pulsing lime dot** = "live / connected / private session."

---

## 8. Component recipes

**App shell** — fixed glass rail + content lifted above the grid:
```
<aside class="bg-sidebar/80 sticky top-0 h-screen w-16 md:w-64 border-r border-white/10 backdrop-blur-xl">
<main> lives inside <div class="relative z-10 flex min-h-screen">
```

**Sidebar nav item** (mono, coded, lime active pill):
```
active:   bg-primary text-primary-foreground  (+ left bar: absolute -left-2 h-5 w-0.5 bg-primary)
inactive: text-zinc-400 hover:bg-white/5 hover:text-white
shared:   font-mono text-[0.8rem] tracking-wide uppercase ; trailing code "01" text-zinc-600
```

**Command bar** (input + CTA):
```
input: h-11 border-white/10 bg-white/5 pl-9 font-mono text-white placeholder:text-zinc-600
       focus-visible:border-lime-500/60 focus-visible:ring-lime-500/25
CTA:   <Button class="accent-glow h-11 px-6">   (lime bg, black text)
```

**Dossier / hero card:**
```
<Card class="scan-sweep animate-reveal py-0">
  <div class="corner-ticks relative flex flex-col gap-6 p-6">
    <div class="eyebrow flex justify-between"><span>Domain Dossier</span><span class="text-zinc-600">SCR/COM</span></div>
    domain: font-display text-2xl font-bold tracking-wide text-white  + .COM outline chip + method chip
    score:  font-mono text-7xl font-bold tabular-nums {gradeColor} + inline grade-colored textShadow
```

**Telemetry log** (live progress) — mono lines under a left guide rail:
```
<ul class="border-l border-white/10 pl-4 font-mono text-sm">
  ▸ {label}            [ OK ] | [ ERR ] | [ ·· ](animate-blink lime)
  glyph color: done=emerald-400, error=amber-400, active=lime-400
```

**Stat tile:** `rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5` → `.eyebrow` label + `font-mono text-zinc-100` value.

**Banner** (e.g. warning): `rounded-lg border border-amber-500/30 bg-amber-500/10 p-4` → `text-amber-300` heading, `text-amber-100/90` body, severity chips `bg-red-500/20 text-red-300` (mono, uppercase, `text-[0.6rem]`).

**Method / status chip:** `rounded-full border px-2 py-0.5 font-mono text-[0.65rem] tracking-wide uppercase` + the semantic palette (Gemini=violet, fallback=amber, mock/rule=white/zinc).

**Tabs:** use the `line` variant; active trigger `data-active:text-lime-400`.

**Code / raw JSON:** `rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-xs text-lime-200/90`.

**Heatmap cells:** filled = semantic `-500`; empty = `bg-white/[0.04]`; all `ring-1 ring-inset ring-white/5`.

---

## 9. Do / Don't

**Do**
- Keep lime as the only brand color; carry meaning with the translucent semantic ramp.
- Put every number/label/domain/timestamp in `font-mono`.
- Use `.eyebrow` kickers (`MODULE 0X · NAME`) above each page title.
- Design **mobile-first** — the rail collapses to `w-16` (icon + logo + status dot); panels stack; verify at 390px.
- Verify visually in a browser (Python Playwright + Chromium are installed) before claiming done.

**Don't**
- No light backgrounds, no `-50/-600` light semantic fills, no opaque gray borders (use `white/10`).
- No second accent hue; no purple-on-white gradients; no Inter/Space Grotesk.
- Don't combine `.scan-sweep` + `.corner-ticks` on one element (§6 gotcha).
- Don't rely on `var(--font-mono)` in raw CSS — `@theme inline` may not emit it; reference the `next/font` var (`var(--font-geist-mono)`) directly.
- Don't name a preview/route folder with a leading underscore — Next App Router treats `_foo`/`__foo` as private (non-routed → 404).

---

## 10. Stack notes

- **Tailwind v4** (`@import "tailwindcss"`), **shadcn Base UI variant** (NOT Radix — Tooltip `delay`, Badge `render`, Tabs/Sheet/Progress APIs differ).
- Tokens flow through `@theme inline { --color-*: var(--*) }`, so flipping `:root` re-themes the whole app; components still hardcode zinc/semantic classes per the ramps above.
- `--radius: 0.5rem` keeps corners technical; `Card` uses `rounded-xl` (≈0.7rem).

