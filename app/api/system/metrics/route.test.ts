import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, runOnTargetMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  runOnTargetMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/shell", () => ({ runOnTarget: (argv: string[]) => runOnTargetMock(argv) }));

import { GET } from "./route";

beforeEach(() => {
  authMock.mockReset();
  runOnTargetMock.mockReset();
});

describe("GET /api/system/metrics", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns metrics JSON when authenticated", async () => {
    authMock.mockResolvedValue({ user: { name: "admin" } });
    runOnTargetMock.mockImplementation((argv: string[]) => {
      const cmd = argv.join(" ");
      if (cmd.includes("/proc/stat")) return ok("cpu  100 0 100 800 0 0 0 0 0 0\ncpu  150 0 150 1000 0 0 0 0 0 0");
      if (cmd.includes("free")) return ok("Mem: 8000 3000 1000 100 4000 5000");
      if (cmd.includes("df")) return ok("h\n/dev/sda1 100K 20K 80K 20% /");
      if (cmd.includes("loadavg")) return ok("0.1 0.2 0.3 1/1 1");
      if (cmd.includes("uptime")) return ok("123.4 0");
      if (cmd.includes("hostname")) return ok("panel-server");
      return fail();
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hostname).toBe("panel-server");
    expect(body.cpu.usagePct).toBeGreaterThanOrEqual(0);
    expect(body.errors).toEqual([]);
  });

  it("returns partial data with errors when a read fails", async () => {
    authMock.mockResolvedValue({ user: { name: "admin" } });
    runOnTargetMock.mockImplementation((argv: string[]) => {
      if (argv.join(" ").includes("hostname")) return fail("boom");
      return ok("0.1 0.2 0.3 1/1 1");
    });
    const res = await GET();
    const body = await res.json();
    expect(body.hostname).toBeNull();
    expect(body.errors.some((e: string) => e.startsWith("hostname"))).toBe(true);
  });
});

function ok(stdout: string) {
  return Promise.resolve({ stdout, stderr: "", success: true });
}
function fail(stderr = "fail") {
  return Promise.resolve({ stdout: "", stderr, success: false });
}
