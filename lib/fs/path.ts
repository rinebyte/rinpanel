import path from "node:path";
import { validateDomain } from "@/lib/nginx/validate";

export type PathValidation =
  | { ok: true; absolute: string }
  | { ok: false; reason: string };

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function validatePath(domain: string, relPath: string): PathValidation {
  const d = validateDomain(domain);
  if (!d.ok) return { ok: false, reason: `invalid domain: ${d.reason}` };

  if (typeof relPath !== "string") return { ok: false, reason: "path is required" };

  const stripped = relPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const base = `/var/www/${domain}`;

  if (stripped === "") return { ok: true, absolute: base };

  if (stripped.length > 4096) return { ok: false, reason: "path too long (max 4096)" };

  const segments = stripped.split("/");
  for (const seg of segments) {
    if (seg === "") return { ok: false, reason: "empty segment (// not allowed)" };
    if (seg === "..") return { ok: false, reason: "parent segment (..) not allowed" };
    if (seg === ".") return { ok: false, reason: "current-dir segment (.) not allowed" };
    if (seg.length > 255) return { ok: false, reason: "segment length exceeds 255" };
    if (seg.startsWith(".")) return { ok: false, reason: "hidden / leading-dot files not allowed" };
    if (!SEGMENT.test(seg)) {
      return { ok: false, reason: "invalid character in path segment" };
    }
  }

  const absolute = path.posix.join(base, ...segments);
  if (!absolute.startsWith(base + "/") && absolute !== base) {
    return { ok: false, reason: "path escapes domain root" };
  }
  return { ok: true, absolute };
}
