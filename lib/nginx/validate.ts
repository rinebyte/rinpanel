export type ValidationResult = { ok: true } | { ok: false; reason: string };

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d+(\.\d+){3}$/;

export function validateDomain(input: unknown): ValidationResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "domain is required" };
  }
  if (input.length > 253) {
    return { ok: false, reason: "domain too long (max 253 chars)" };
  }
  if (input !== input.toLowerCase()) {
    return { ok: false, reason: "domain must be lowercase" };
  }
  if (!/^[a-z0-9.\-]+$/.test(input)) {
    return { ok: false, reason: "invalid character (only a-z, 0-9, '.' and '-' allowed)" };
  }
  if (input.includes("..")) {
    return { ok: false, reason: "consecutive dots are not allowed" };
  }
  if (input === "localhost") {
    return { ok: false, reason: "localhost is not allowed" };
  }
  if (IPV4.test(input)) {
    return { ok: false, reason: "ip addresses are not allowed" };
  }
  const labels = input.split(".");
  if (labels.length < 2) {
    return { ok: false, reason: "must have at least 2 labels (FQDN required, e.g. example.com)" };
  }
  for (const label of labels) {
    if (label.length > 63) {
      return { ok: false, reason: `label too long (max 63 chars, got ${label.length})` };
    }
    if (!LABEL.test(label)) {
      return { ok: false, reason: `invalid label: "${label}" (labels must be 1-63 chars, a-z/0-9/hyphen, no leading/trailing hyphen)` };
    }
  }
  return { ok: true };
}
