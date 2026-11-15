import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const CheckinBody = z.object({}).strict();

export async function POST(request: Request) {
  try {
    CheckinBody.parse(await request.json());
    const profile = await requireRole("worker");
    const now = new Date().toISOString();
    const admin = createAdminClient();
    const [positionResult, alertsResult] = await Promise.all([
      admin
        .from("worker_positions")
        .update({ status: "ok", last_motion_at: now, updated_at: now })
        .eq("profile_id", profile.id)
        .eq("org_id", profile.org_id)
        .eq("site_id", profile.site_id)
        .select("profile_id")
        .maybeSingle(),
      admin
        .from("alerts")
        .update({ status: "resolved", resolved_at: now, resolved_by: profile.id })
        .eq("org_id", profile.org_id)
        .eq("site_id", profile.site_id)
        .eq("subject_id", profile.id)
        .eq("status", "open")
        .in("type", ["no_response", "no_heartbeat", "sos"]),
    ]);
    if (positionResult.error) throw positionResult.error;
    if (alertsResult.error) throw alertsResult.error;
    if (!positionResult.data) throw new Error("Worker position not found");

    console.info(`[checkin] ${profile.id} confirmed they are okay`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Expected an empty JSON body" }, { status: 400 });
    console.error("Unable to record worker check-in", error);
    return NextResponse.json({ error: "Unable to record worker check-in" }, { status: 500 });
  }
}
