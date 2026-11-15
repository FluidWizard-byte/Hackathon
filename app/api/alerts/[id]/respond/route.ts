import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const AlertId = z.string().uuid();

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireRole("worker", "supervisor");
    const { id } = await params;
    const alertId = AlertId.parse(id);
    const admin = createAdminClient();
    const { data: alert, error: alertError } = await admin
      .from("alerts")
      .select("id, site_id")
      .eq("id", alertId)
      .eq("org_id", profile.org_id)
      .maybeSingle();
    if (alertError) throw alertError;
    if (!alert || (profile.role === "supervisor" && alert.site_id !== profile.site_id)) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { data: recipient, error: recipientError } = await admin
      .from("alert_recipients")
      .update({ responded: true, responded_at: now })
      .eq("alert_id", alertId)
      .eq("profile_id", profile.id)
      .select("profile_id")
      .maybeSingle();
    if (recipientError) throw recipientError;
    if (!recipient) return NextResponse.json({ error: "You are not an alert recipient" }, { status: 403 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid alert ID" }, { status: 400 });
    console.error("Unable to record alert response", error);
    return NextResponse.json({ error: "Unable to record alert response" }, { status: 500 });
  }
}
