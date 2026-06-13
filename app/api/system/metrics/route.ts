import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMetrics } from "@/lib/system/metrics";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const metrics = await getMetrics();
  return NextResponse.json(metrics);
}
