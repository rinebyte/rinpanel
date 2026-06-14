import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

function useDocker(): boolean {
  return process.env.USE_DOCKER === "true";
}

function containerName(): string {
  return process.env.CONTAINER_NAME ?? "panel-server";
}

function dockerCp(src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", ["cp", src, dst], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (c) => { stderr += c.toString(); });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`docker cp exit ${code}: ${stderr.trim()}`)),
    );
  });
}

/**
 * Write a file to the *target* — the dev container (USE_DOCKER=true)
 * or the host (prod). Uses `docker cp` for the dev path so the file
 * lands at the literal `targetPath` inside the container, with no
 * shell interpolation of the content.
 */
export async function writeFileOnTarget(
  targetPath: string,
  content: string | Uint8Array,
): Promise<void> {
  if (useDocker()) {
    const tmp = join(tmpdir(), `rinpanel-${randomBytes(8).toString("hex")}`);
    await writeFile(tmp, content);
    try {
      await dockerCp(tmp, `${containerName()}:${targetPath}`);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  } else {
    await writeFile(targetPath, content);
  }
}
