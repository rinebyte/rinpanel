import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCommand, runOnTarget } from "@/lib/shell";
import { applyVhost, removeVhost, renameVhost } from "./vhost";

const TEST = "rinpanel-int-test.localdomain";
const TEST_RENAMED = "rinpanel-int-test-renamed.localdomain";

async function dockerUp(): Promise<boolean> {
  const r = await runCommand(["docker", "info"]);
  return r.success;
}

async function curlInContainer(host: string): Promise<{ status: number; body: string }> {
  const r = await runOnTarget([
    "curl", "-s", "-o", "/tmp/_curl_body", "-w", "%{http_code}",
    "-H", `Host: ${host}`,
    "http://127.0.0.1/",
  ]);
  const body = (await runOnTarget(["cat", "/tmp/_curl_body"])).stdout;
  return { status: Number(r.stdout.trim()), body };
}

let dockerReady = false;
beforeAll(async () => {
  dockerReady = (await dockerUp()) && process.env.USE_DOCKER === "true";
  if (!dockerReady) console.log("vhost.test: skipping — Docker not available / USE_DOCKER!=true");
  if (dockerReady) {
    await removeVhost(TEST, { wipeWebroot: true });
    await removeVhost(TEST_RENAMED, { wipeWebroot: true });
  }
}, 30_000);

afterAll(async () => {
  if (dockerReady) {
    await removeVhost(TEST, { wipeWebroot: true });
    await removeVhost(TEST_RENAMED, { wipeWebroot: true });
  }
}, 30_000);

describe("vhost integration (container)", () => {
  it("applies a vhost and serves the placeholder", async () => {
    if (!dockerReady) return;
    const r = await applyVhost(TEST);
    expect(r.ok).toBe(true);
    const got = await curlInContainer(TEST);
    expect(got.status).toBe(200);
    expect(got.body.toUpperCase()).toContain("PROVISIONED");
  }, 30_000);

  it("renames a vhost — old name 404s, new name serves", async () => {
    if (!dockerReady) return;
    const r = await renameVhost(TEST, TEST_RENAMED);
    expect(r.ok).toBe(true);
    expect((await curlInContainer(TEST_RENAMED)).status).toBe(200);
    const old = await curlInContainer(TEST);
    expect(old.body.toUpperCase()).not.toContain("PROVISIONED");
  }, 30_000);

  it("removes a vhost — domain stops serving", async () => {
    if (!dockerReady) return;
    const r = await removeVhost(TEST_RENAMED, { wipeWebroot: true });
    expect(r.ok).toBe(true);
    const got = await curlInContainer(TEST_RENAMED);
    expect(got.body.toUpperCase()).not.toContain("PROVISIONED");
  }, 30_000);
});
