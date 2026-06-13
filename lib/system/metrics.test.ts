import { describe, it, expect } from "vitest";
import { parseCpuUsage, parseMemory, parseDisk, parseLoadAvg, parseUptime } from "./metrics";

describe("parseCpuUsage", () => {
  it("computes busy% across two /proc/stat samples", () => {
    const raw = [
      "cpu  100 0 100 800 0 0 0 0 0 0",
      "cpu0 50 0 50 400 0 0 0 0 0 0",
      "cpu  150 0 150 1000 0 0 0 0 0 0",
      "cpu0 75 0 75 500 0 0 0 0 0 0",
    ].join("\n");
    // totalΔ = (150+150+1000) - (100+100+800) = 1300-1000 = 300; idleΔ = 1000-800 = 200; busy = 100/300 = 33.3
    expect(parseCpuUsage(raw).usagePct).toBeCloseTo(33.3, 1);
  });
});

describe("parseMemory", () => {
  it("parses free -m and computes usage from available", () => {
    const raw = [
      "               total        used        free      shared  buff/cache   available",
      "Mem:            8000        3000        1000         100        4000        5000",
      "Swap:           2047           0        2047",
    ].join("\n");
    const m = parseMemory(raw);
    expect(m.totalMb).toBe(8000);
    expect(m.usedMb).toBe(3000);
    expect(m.availMb).toBe(5000);
    expect(m.usagePct).toBeCloseTo(37.5, 1); // (8000-5000)/8000
  });
});

describe("parseDisk", () => {
  it("parses df -P -BK / output", () => {
    const raw = [
      "Filesystem     1024-blocks      Used Available Capacity Mounted on",
      "/dev/sda1      61255492K  12000000K  49255492K      20% /",
    ].join("\n");
    const d = parseDisk(raw);
    expect(d.sizeKb).toBe(61255492);
    expect(d.usedKb).toBe(12000000);
    expect(d.availKb).toBe(49255492);
    expect(d.usagePct).toBe(20);
    expect(d.mount).toBe("/");
  });

  it("throws on malformed df output", () => {
    expect(() => parseDisk("garbage\nnot a valid df line")).toThrow();
  });
});

describe("parseLoadAvg", () => {
  it("parses /proc/loadavg", () => {
    const d = parseLoadAvg("0.52 0.58 0.59 1/823 12345");
    expect(d).toEqual({ one: 0.52, five: 0.58, fifteen: 0.59 });
  });
});

describe("parseUptime", () => {
  it("parses /proc/uptime seconds", () => {
    expect(parseUptime("12345.67 98765.43")).toBe(12345);
  });
});
