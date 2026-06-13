import { describe, it, expect } from "vitest";
import { validateDomain } from "./validate";

const ok = (d: string) => expect(validateDomain(d).ok).toBe(true);
const bad = (d: string, reasonMatches?: RegExp) => {
  const r = validateDomain(d);
  expect(r.ok).toBe(false);
  if (!r.ok && reasonMatches) expect(r.reason).toMatch(reasonMatches);
};

describe("validateDomain", () => {
  it("accepts canonical hostnames", () => {
    ok("example.com");
    ok("sub.example.com");
    ok("a.b");
    ok("123-foo.example-site.co");
    ok("deep.sub.example.org");
  });

  it("rejects empty / non-string", () => {
    bad("", /required|empty/i);
  });

  it("rejects single-label (not FQDN)", () => {
    bad("example", /fqdn|labels/i);
  });

  it("rejects mixed-case", () => {
    bad("Example.com", /lowercase/i);
    bad("EXAMPLE.COM", /lowercase/i);
  });

  it("rejects forbidden characters", () => {
    bad("foo bar.com", /character/i);
    bad("foo/bar.com", /character/i);
    bad("foo_bar.com", /character/i);
    bad("foo$bar.com", /character/i);
  });

  it("rejects double-dot / leading or trailing dot", () => {
    bad("foo..com", /consecutive|label/i);
    bad(".foo.com", /label/i);
    bad("foo.com.", /label/i);
  });

  it("rejects bad label edges (hyphen at start or end)", () => {
    bad("-foo.com", /label/i);
    bad("foo-.com", /label/i);
  });

  it("rejects overly long labels and total length", () => {
    bad("a".repeat(64) + ".com", /label/i);
    bad("a".repeat(250) + ".co", /253|long/i);
  });

  it("rejects localhost and IPv4", () => {
    bad("localhost", /localhost/i);
    bad("192.168.1.1", /ip/i);
    bad("10.0.0.1", /ip/i);
  });
});
