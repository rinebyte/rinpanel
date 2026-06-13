# rinpanel Polish Slice: Logout + Rate-limit + User Badge — Plan

**Goal:** Add a confirm-dialog logout, sidebar user badge, login rate-limiting, and a `logout` audit event — a small polish batch on top of Slice 1.

**Approach:** In-memory IP rate-limiter (single-admin VPS → process-local map is enough; restart-reset acceptable, YAGNI). Native HTML `<dialog>` for the confirm modal (focus-trap + ESC + backdrop free). Logout as a server action that records the audit event before `signOut`. Username threaded into the existing `Sidebar` via prop from the auth-gated `(dashboard)/layout.tsx` server component.

**No schema changes. No new deps.** Files touched:

| File | Change |
|---|---|
| `lib/auth/rate-limit.ts` | NEW — sliding-window in-memory limiter |
| `lib/auth/rate-limit.test.ts` | NEW — unit tests (Vitest) |
| `app/(auth)/login/actions.ts` | MODIFY — IP from headers, isBlocked → record/clear |
| `app/(dashboard)/logout-action.ts` | NEW — server action; logActivity + signOut |
| `components/app-shell/sidebar.tsx` | MODIFY — `username` prop, footer redesign, `<dialog>` confirm |
| `app/(dashboard)/layout.tsx` | MODIFY — pass `session.user.name` to `<Sidebar>` |

## Configuration

- **Window:** 10 minutes
- **Max attempts per IP:** 7
- **Block message:** "Too many failed attempts. Try again in 10 minutes."
- **IP source:** `(await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? get("x-real-ip") ?? "unknown"`
- **In-memory key:** the IP string (so `"unknown"` collapses everyone under one bucket — fine for dev; in prod ensure the reverse proxy sets a real IP header)

## Tasks (TDD where it adds value)

### P1 — Rate-limit module (TDD)

`lib/auth/rate-limit.ts`:
```ts
export interface RateLimitState {
  blocked: boolean;
  remaining: number;
  msUntilReset: number;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 7;

interface Entry { count: number; firstAt: number }
const attempts = new Map<string, Entry>();

function purge(ip: string, now: number): Entry | undefined {
  const e = attempts.get(ip);
  if (!e) return undefined;
  if (now - e.firstAt > WINDOW_MS) {
    attempts.delete(ip);
    return undefined;
  }
  return e;
}

export function isBlocked(ip: string, now: number = Date.now()): boolean {
  const e = purge(ip, now);
  return !!e && e.count >= MAX_ATTEMPTS;
}

export function recordFailure(ip: string, now: number = Date.now()): RateLimitState {
  let e = purge(ip, now);
  if (!e) {
    e = { count: 1, firstAt: now };
    attempts.set(ip, e);
  } else {
    e.count++;
  }
  return {
    blocked: e.count >= MAX_ATTEMPTS,
    remaining: Math.max(0, MAX_ATTEMPTS - e.count),
    msUntilReset: Math.max(0, WINDOW_MS - (now - e.firstAt)),
  };
}

export function clearFailures(ip: string): void {
  attempts.delete(ip);
}

// Test seam — DO NOT call from app code.
export function _resetForTests(): void {
  attempts.clear();
}
```

`lib/auth/rate-limit.test.ts` (TDD, write first):
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { isBlocked, recordFailure, clearFailures, _resetForTests } from "./rate-limit";

beforeEach(() => _resetForTests());

describe("rate-limit", () => {
  it("is unblocked initially", () => {
    expect(isBlocked("1.2.3.4")).toBe(false);
  });

  it("blocks after 7 failures", () => {
    for (let i = 0; i < 6; i++) {
      expect(recordFailure("1.2.3.4").blocked).toBe(false);
    }
    expect(recordFailure("1.2.3.4").blocked).toBe(true);
    expect(isBlocked("1.2.3.4")).toBe(true);
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 7; i++) recordFailure("1.1.1.1");
    expect(isBlocked("1.1.1.1")).toBe(true);
    expect(isBlocked("2.2.2.2")).toBe(false);
  });

  it("clears failures on success", () => {
    recordFailure("3.3.3.3");
    clearFailures("3.3.3.3");
    expect(isBlocked("3.3.3.3")).toBe(false);
  });

  it("expires entries after the window", () => {
    const t0 = 1_000_000;
    recordFailure("4.4.4.4", t0);
    recordFailure("4.4.4.4", t0);
    expect(isBlocked("4.4.4.4", t0 + 60_000)).toBe(false);
    expect(isBlocked("4.4.4.4", t0 + 10 * 60_000 + 1)).toBe(false);
    // After expiry, the next failure starts a fresh window
    const r = recordFailure("4.4.4.4", t0 + 10 * 60_000 + 1);
    expect(r.remaining).toBe(6);
  });
});
```

### P2 — Wire into login action

`app/(auth)/login/actions.ts` becomes:
```ts
"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { isBlocked, recordFailure, clearFailures } from "@/lib/auth/rate-limit";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function login(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const ip = await getClientIp();
  if (isBlocked(ip)) return "Too many failed attempts. Try again in 10 minutes.";

  try {
    await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      recordFailure(ip);
      return "Invalid credentials";
    }
    clearFailures(ip); // NEXT_REDIRECT control-flow signal = success
    throw err;
  }
}
```

### P3 — Logout server action

`app/(dashboard)/logout-action.ts`:
```ts
"use server";

import { auth, signOut } from "@/auth";
import { logActivity } from "@/lib/system/activity";

export async function logout(): Promise<void> {
  const session = await auth();
  if (session?.user?.name) logActivity("logout", session.user.name);
  await signOut({ redirectTo: "/login" });
}
```

### P4 — Sidebar redesign

`app/(dashboard)/layout.tsx` — pass username to sidebar:
```tsx
<Sidebar username={session.user?.name ?? "admin"} />
```

`components/app-shell/sidebar.tsx` — add `username` prop, replace footer block. Native `<dialog>`:
- A `<dialog>` element with ref; opened via `dialogRef.current?.showModal()`; closes on ESC/backdrop/cancel button automatically (form `method="dialog"` for cancel).
- Logout button = form whose action is the `logout` server action; submit closes dialog and triggers redirect.
- Mobile (w-16): just avatar + logout icon stacked; desktop (md): avatar + name + status dot row, with separate Logout button row underneath.

PHOSPHOR styling: `.glass`, `.corner-ticks`, eyebrow labels, lime accent on Logout button, red border on Cancel.

### P5 — Verify + merge

- `npm test` — full suite green (+5 new = 20 total).
- `npm run build` — clean.
- Live QA with Playwright: login → dashboard → click logout button → dialog appears → click Cancel (closes) → click Logout again → confirm → redirected to `/login`. Verify `activityLogs` has a `logout` row (or check via UI after re-login).
- Commit each task individually; merge to main; push.

## Self-review

- **Spec coverage:** logout + confirm dialog (P3+P4), user badge in sidebar (P4), rate-limit /login (P1+P2), audit logout event (P3 via `logActivity`). All four user-selected items covered.
- **Placeholder scan:** none — all code blocks complete.
- **Type consistency:** `isBlocked`/`recordFailure`/`clearFailures`/`_resetForTests` names match across rate-limit module/test/action consumer.
