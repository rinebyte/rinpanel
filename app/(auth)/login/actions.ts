"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { isBlocked, recordFailure, clearFailures } from "@/lib/auth/rate-limit";

async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function login(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const ip = await getClientIp();
  if (isBlocked(ip)) return "Too many failed attempts. Try again in 10 minutes.";

  try {
    await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      recordFailure(ip);
      return "Invalid credentials";
    }
    clearFailures(ip); // NEXT_REDIRECT control-flow signal = success
    throw err;
  }
}
