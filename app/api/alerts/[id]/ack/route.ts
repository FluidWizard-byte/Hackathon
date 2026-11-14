import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireRole("worker", "supervisor", "manager", "admin");
    const { id } = await params;
    const admin = createAdminClient();
    const { data: alert, error: alertError } = await admin
      .from("alerts")
      .select("id, site_id")
      .eq("id", id)
      .eq("org_id", profile.org_id)
      .maybeSingle();
    if (alertError || !alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

    if (profile.role === "worker") {
      const { data: recipient, error: recipientError } = await admin
        .from("alert_recipients")
        .select("profile_id")
        .eq("alert_id", alert.id)
        .eq("profile_id", profile.id)
        .maybeSingle();
      if (recipientError || !recipient) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (profile.role === "supervisor" && alert.site_id !== profile.site_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await admin.from("alerts").update({ status: "acknowledged", acknowledged_by: profile.id }).eq("id", alert.id);
    if (error) return NextResponse.json({ error: "Unable to acknowledge alert" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
