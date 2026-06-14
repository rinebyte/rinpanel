import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCommand, runOnTarget } from "@/lib/shell";
import { applyVhost, removeVhost, renameVhost, readVhostConfig, updateVhostConfig } from "./vhost";

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
    expect(got.body).toContain(TEST);
  }, 30_000);

  it("renames a vhost — old name 404s, new name serves", async () => {
    if (!dockerReady) return;
    const r = await renameVhost(TEST, TEST_RENAMED);
    expect(r.ok).toBe(true);
    expect((await curlInContainer(TEST_RENAMED)).status).toBe(200);
    const old = await curlInContainer(TEST);
    expect(old.body).not.toContain(TEST);
  }, 30_000);

  it("removes a vhost — domain stops serving", async () => {
    if (!dockerReady) return;
    const r = await removeVhost(TEST_RENAMED, { wipeWebroot: true });
    expect(r.ok).toBe(true);
    const got = await curlInContainer(TEST_RENAMED);
    expect(got.body).not.toContain(TEST_RENAMED);
  }, 30_000);
});

describe("config edit integration", () => {
  const TEST = "rinpanel-cfg-test.localdomain";

  beforeAll(async () => {
    if (!dockerReady) return;
    await removeVhost(TEST, { wipeWebroot: true });
    const r = await applyVhost(TEST);
    if (!r.ok) throw new Error(`fixture vhost failed: ${r.error}`);
  }, 30_000);

  afterAll(async () => {
    if (dockerReady) await removeVhost(TEST, { wipeWebroot: true });
  }, 30_000);

  it("readVhostConfig returns current content", async () => {
    if (!dockerReady) return;
    const r = await readVhostConfig(TEST);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain(`server_name ${TEST}`);
    }
  }, 30_000);

  it("updateVhostConfig with valid content reloads nginx", async () => {
    if (!dockerReady) return;
    const newContent = `# custom by test\nserver {\n    listen 80;\n    server_name ${TEST};\n    root /var/www/${TEST}/public_html;\n    index index.html;\n    location / { try_files $uri $uri/ =404; }\n}\n`;
    const r = await updateVhostConfig(TEST, newContent);
    expect(r.ok).toBe(true);
    const read = await readVhostConfig(TEST);
    // runOnTarget trims stdout; compare against trimmed expectation
    expect(read.ok && read.content).toBe(newContent.trimEnd());
  }, 30_000);

  it("updateVhostConfig with broken nginx syntax rolls back", async () => {
    if (!dockerReady) return;
    const before = await readVhostConfig(TEST);
    expect(before.ok).toBe(true);
    const previousContent = before.ok ? before.content : "";

    const bad = `server {\n    this is not valid nginx;\n}\n`;
    const r = await updateVhostConfig(TEST, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toMatch(/syntax|invalid|emerg|nginx/);

    // Disk content should be restored
    const after = await readVhostConfig(TEST);
    expect(after.ok && after.content).toBe(previousContent);
  }, 30_000);

  it("rejects empty content + oversized content", async () => {
    if (!dockerReady) return;
    expect((await updateVhostConfig(TEST, "")).ok).toBe(false);
    expect((await updateVhostConfig(TEST, "x".repeat(60_000))).ok).toBe(false);
  });
});
