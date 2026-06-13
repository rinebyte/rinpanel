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
    const r = recordFailure("4.4.4.4", t0 + 10 * 60_000 + 1);
    expect(r.remaining).toBe(6);
  });
});
