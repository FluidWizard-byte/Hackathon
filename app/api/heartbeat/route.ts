import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body) || !("moving" in body) || typeof body.moving !== "boolean") return NextResponse.json({ error: "moving must be a boolean" }, { status: 400 });
    const profile = await requireRole("worker");
    const now = new Date().toISOString();
    const update: { on_shift: boolean; last_heartbeat_at: string; updated_at: string; last_motion_at?: string } = { on_shift: true, last_heartbeat_at: now, updated_at: now };
    if (body.moving) update.last_motion_at = now;
    const { error } = await createAdminClient().from("worker_positions").update(update).eq("profile_id", profile.id).eq("org_id", profile.org_id).eq("site_id", profile.site_id);
    if (error) return NextResponse.json({ error: "Unable to record heartbeat" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
