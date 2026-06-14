import { describe, it, expect } from "vitest";
import { validatePath } from "./path";

const ok = (d: string, rel: string, expectedAbs?: string) => {
  const r = validatePath(d, rel);
  expect(r.ok).toBe(true);
  if (r.ok && expectedAbs) expect(r.absolute).toBe(expectedAbs);
};
const bad = (d: string, rel: string, reasonMatches?: RegExp) => {
  const r = validatePath(d, rel);
  expect(r.ok).toBe(false);
  if (!r.ok && reasonMatches) expect(r.reason).toMatch(reasonMatches);
};

describe("validatePath", () => {
  it("accepts the root", () => ok("example.com", "", "/var/www/example.com"));
  it("accepts plain subpaths", () => {
    ok("example.com", "public_html", "/var/www/example.com/public_html");
    ok("example.com", "public_html/index.html", "/var/www/example.com/public_html/index.html");
    ok("example.com", "a/b/c.txt", "/var/www/example.com/a/b/c.txt");
  });
  it("strips a leading slash", () => ok("example.com", "/public_html", "/var/www/example.com/public_html"));
  it("strips a trailing slash", () => ok("example.com", "public_html/", "/var/www/example.com/public_html"));

  it("rejects parent-dir segments", () => {
    bad("example.com", "..", /parent|\.\./i);
    bad("example.com", "public_html/../../etc/passwd", /parent|\.\./i);
    bad("example.com", "a/../b", /parent|\.\./i);
  });
  it("rejects current-dir segments", () => bad("example.com", "./foo", /current|\./i));
  it("rejects empty segments (//)", () => bad("example.com", "foo//bar", /empty/i));
  it("rejects leading-dot filenames (hidden files blocked)", () => {
    bad("example.com", ".htaccess", /hidden|leading/i);
    bad("example.com", "public_html/.env", /hidden|leading/i);
  });
  it("rejects forbidden characters", () => {
    bad("example.com", "foo\0bar", /character/i);
    bad("example.com", "foo\nbar", /character/i);
    bad("example.com", "foo/bar baz/qux", /character|space/i);
  });
  it("rejects too-long filename segment (POSIX 255)", () => {
    bad("example.com", "a".repeat(256), /length|255/i);
  });
  it("rejects invalid domain", () => {
    bad("BAD", "foo", /domain/i);
    bad("..", "foo", /domain/i);
  });
});
