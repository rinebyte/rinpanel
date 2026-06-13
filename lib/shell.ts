import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ShellResult {
  stdout: string;
  stderr: string;
  success: boolean;
}

function containerName(): string {
  return process.env.CONTAINER_NAME ?? "panel-server";
}

function useDocker(): boolean {
  return process.env.USE_DOCKER === "true";
}

/** Execute argv directly on the host — NO shell, so args are never interpreted. */
export async function runCommand(argv: string[]): Promise<ShellResult> {
  const [cmd, ...args] = argv;
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.toString().trim(), stderr: stderr.toString().trim(), success: true };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: e.stdout?.toString().trim() ?? "",
      stderr: (e.stderr?.toString() || e.message || "command failed").trim(),
      success: false,
    };
  }
}

/** Run argv inside the dev container via `docker exec`. */
export async function runInContainer(argv: string[]): Promise<ShellResult> {
  return runCommand(["docker", "exec", containerName(), ...argv]);
}

/** The seam services call: container in dev (USE_DOCKER=true), host in prod. */
export async function runOnTarget(argv: string[]): Promise<ShellResult> {
  return useDocker() ? runInContainer(argv) : runCommand(argv);
}
