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
