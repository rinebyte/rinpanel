import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileOnTarget } from "./target-fs";

describe("writeFileOnTarget — host path (USE_DOCKER=false)", () => {
  let dir: string;
  let savedFlag: string | undefined;

  beforeEach(async () => {
    savedFlag = process.env.USE_DOCKER;
    process.env.USE_DOCKER = "false";
    dir = await mkdtemp(join(tmpdir(), "rinpanel-tfs-"));
  });

  afterEach(async () => {
    if (savedFlag === undefined) delete process.env.USE_DOCKER;
    else process.env.USE_DOCKER = savedFlag;
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the file directly to the host path", async () => {
    const target = join(dir, "out.txt");
    await writeFileOnTarget(target, "hello world");
    expect(await readFile(target, "utf8")).toBe("hello world");
  });

  it("overwrites an existing file", async () => {
    const target = join(dir, "out.txt");
    await writeFile(target, "old");
    await writeFileOnTarget(target, "new");
    expect(await readFile(target, "utf8")).toBe("new");
  });
});
