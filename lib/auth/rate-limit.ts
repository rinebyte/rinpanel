export interface RateLimitState {
  blocked: boolean;
  remaining: number;
  msUntilReset: number;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 7;

interface Entry {
  count: number;
  firstAt: number;
}

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

// Test seam — do not call from app code.
export function _resetForTests(): void {
  attempts.clear();
}
