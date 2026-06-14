import { describe, it, expect } from "vitest";
import { classifyIssuer, isCloudflareNs } from "./ssl-detect";

describe("isCloudflareNs", () => {
  it("returns true for cloudflare nameservers (case insensitive, trailing dot)", () => {
    expect(isCloudflareNs(["val.ns.cloudflare.com"])).toBe(true);
    expect(isCloudflareNs(["fred.ns.cloudflare.com."])).toBe(true);
    expect(isCloudflareNs(["VAL.NS.CLOUDFLARE.COM"])).toBe(true);
    expect(isCloudflareNs(["fred.ns.cloudflare.com", "val.ns.cloudflare.com"])).toBe(true);
  });
  it("returns false for non-cloudflare nameservers", () => {
    expect(isCloudflareNs(["ns1.google.com"])).toBe(false);
    expect(isCloudflareNs(["ns1.example.com", "ns2.example.com"])).toBe(false);
    expect(isCloudflareNs([])).toBe(false);
  });
});

describe("classifyIssuer", () => {
  it("returns cloudflare for CF issuer", () => {
    expect(classifyIssuer("Cloudflare Inc ECC CA-3")).toBe("cloudflare");
    expect(classifyIssuer("Cloudflare, Inc.")).toBe("cloudflare");
  });
  it("returns letsencrypt for LE issuer or intermediates", () => {
    expect(classifyIssuer("Let's Encrypt")).toBe("letsencrypt");
    expect(classifyIssuer("R3")).toBe("letsencrypt");
    expect(classifyIssuer("E5")).toBe("letsencrypt");
    expect(classifyIssuer("R10")).toBe("letsencrypt");
  });
  it("returns origin for other valid issuers", () => {
    expect(classifyIssuer("DigiCert TLS RSA SHA256 2020 CA1")).toBe("origin");
    expect(classifyIssuer("ZeroSSL ECC Domain Secure Site CA")).toBe("origin");
  });
  it("returns none for empty issuer", () => {
    expect(classifyIssuer("")).toBe("none");
    expect(classifyIssuer("   ")).toBe("none");
  });
});
