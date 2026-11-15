import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const AlertId = z.string().uuid();

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireRole("supervisor", "manager", "admin");
    const { id } = await params;
    const alertId = AlertId.parse(id);
    const admin = createAdminClient();
    const { data: alert, error: alertError } = await admin
      .from("alerts")
      .select("id, site_id, subject_id, type")
      .eq("id", alertId)
      .eq("org_id", profile.org_id)
      .maybeSingle();
    if (alertError) throw alertError;
    if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    if (profile.role === "supervisor" && alert.site_id !== profile.site_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date().toISOString();
    const { data: updatedAlert, error } = await admin
      .from("alerts")
      .update({ status: "resolved", resolved_by: profile.id, resolved_at: now })
      .eq("id", alert.id)
      .eq("org_id", profile.org_id)
      .eq("site_id", alert.site_id)
      .select("id, subject_id, type")
      .maybeSingle();
    if (error) throw error;
    if (!updatedAlert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

    if (
      updatedAlert.subject_id &&
      (updatedAlert.type === "no_response" || updatedAlert.type === "no_heartbeat" || updatedAlert.type === "sos")
    ) {
      const { data: updatedPosition, error: positionError } = await admin
        .from("worker_positions")
        .update({ status: "ok" })
        .eq("profile_id", updatedAlert.subject_id)
        .eq("org_id", profile.org_id)
        .eq("site_id", alert.site_id)
        .select("profile_id")
        .maybeSingle();
      if (positionError) throw positionError;
      if (!updatedPosition) return NextResponse.json({ error: "Worker position not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid alert ID" }, { status: 400 });
    console.error("Unable to resolve alert", error);
    return NextResponse.json({ error: "Unable to resolve alert" }, { status: 500 });
  }
}
