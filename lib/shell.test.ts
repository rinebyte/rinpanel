import { describe, it, expect } from "vitest";
import { runCommand } from "./shell";

describe("runCommand", () => {
  it("returns success and trimmed stdout for a valid command", async () => {
    const r = await runCommand(["echo", "hello"]);
    expect(r.success).toBe(true);
    expect(r.stdout).toBe("hello");
  });

  it("returns success=false for a failing command", async () => {
    const r = await runCommand(["false"]);
    expect(r.success).toBe(false);
  });

  it("does not invoke a shell (args are literal, not interpreted)", async () => {
    // If a shell ran, '$(whoami)' would expand. With execFile it is a literal arg.
    const r = await runCommand(["echo", "$(whoami)"]);
    expect(r.stdout).toBe("$(whoami)");
  });
});
