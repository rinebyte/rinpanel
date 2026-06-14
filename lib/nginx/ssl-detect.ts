import { resolveNs } from "node:dns/promises";
import { connect, type TLSSocket } from "node:tls";

export type SslProvider = "cloudflare" | "letsencrypt" | "origin" | "none" | "unknown";

interface CacheEntry { provider: SslProvider; ts: number }
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function isCloudflareNs(ns: string[]): boolean {
  return ns.some((n) => n.toLowerCase().replace(/\.$/, "").endsWith(".ns.cloudflare.com"));
}

export function classifyIssuer(issuerOrCn: string): SslProvider {
  const s = issuerOrCn.toLowerCase();
  if (!s.trim()) return "none";
  if (s.includes("cloudflare")) return "cloudflare";
  if (s.includes("let's encrypt") || s.includes("lets encrypt")) return "letsencrypt";
  if (/\b(r3|r5|r10|r11|e1|e5|e6)\b/i.test(issuerOrCn)) return "letsencrypt";
  return "origin";
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function detectViaNs(domain: string, timeoutMs: number): Promise<"cloudflare" | "other" | "none"> {
  const result = await withTimeout(
    resolveNs(domain).catch(() => null),
    timeoutMs,
    null,
  );
  if (!result || result.length === 0) return "none";
  return isCloudflareNs(result) ? "cloudflare" : "other";
}

function detectViaCert(domain: string, timeoutMs: number): Promise<SslProvider> {
  return new Promise((resolve) => {
    let sock: TLSSocket | undefined;
    let settled = false;
    const done = (p: SslProvider) => {
      if (settled) return;
      settled = true;
      sock?.destroy();
      resolve(p);
    };
    const timer = setTimeout(() => done("none"), timeoutMs);

    try {
      sock = connect({
        host: domain,
        port: 443,
        servername: domain,
        timeout: timeoutMs,
        rejectUnauthorized: false,
      });
    } catch {
      clearTimeout(timer);
      return done("none");
    }

    sock.once("secureConnect", () => {
      try {
        const cert = sock!.getPeerCertificate();
        const issuerO = [cert.issuer?.O ?? ""].flat()[0] ?? "";
        const issuerCN = [cert.issuer?.CN ?? ""].flat()[0] ?? "";
        const provider = classifyIssuer(issuerO || issuerCN);
        clearTimeout(timer);
        done(provider);
      } catch {
        clearTimeout(timer);
        done("none");
      }
    });
    sock.once("error", () => { clearTimeout(timer); done("none"); });
    sock.once("timeout", () => { clearTimeout(timer); done("none"); });
  });
}

export async function detectSslProvider(
  domain: string,
  opts: { timeoutMs?: number; bypassCache?: boolean } = {},
): Promise<SslProvider> {
  if (!opts.bypassCache) {
    const cached = cache.get(domain);
    if (cached && Date.now() - cached.ts < CACHE_MS) return cached.provider;
  }

  const timeoutMs = opts.timeoutMs ?? 3000;
  const [ns, cert] = await Promise.allSettled([
    detectViaNs(domain, timeoutMs),
    detectViaCert(domain, timeoutMs),
  ]);

  let provider: SslProvider = "unknown";
  if (ns.status === "fulfilled" && ns.value === "cloudflare") {
    provider = "cloudflare";
  } else if (cert.status === "fulfilled" && cert.value !== "none") {
    provider = cert.value;
  } else if (ns.status === "fulfilled" && ns.value === "other") {
    provider = "none";
  }

  cache.set(domain, { provider, ts: Date.now() });
  return provider;
}

// Test seam — do not call from app code
export function _clearCacheForTests(): void { cache.clear(); }
