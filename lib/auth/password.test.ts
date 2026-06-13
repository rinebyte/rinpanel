import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("verifies a correct password against its hash", () => {
    const hash = hashPassword("s3cret!");
    expect(verifyPassword("s3cret!", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("s3cret!");
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces different hashes for the same input (salted)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});
