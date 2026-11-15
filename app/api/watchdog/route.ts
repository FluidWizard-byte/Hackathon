import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { runNoHeartbeatWatchdog } from "@/lib/escalation-service";

export async function POST() {
  try {
    await requireRole("admin");
    const escalated = await runNoHeartbeatWatchdog();
    return NextResponse.json({ ok: true, escalated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Watchdog failed", error);
    return NextResponse.json({ error: "Watchdog failed" }, { status: 500 });
  }
}
