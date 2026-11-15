import { NextResponse } from "next/server";

import { createAlert } from "@/lib/alerts";
import { requireRole } from "@/lib/auth";
import { centroid, type Polygon } from "@/lib/geometry";
import { createAdminClient } from "@/lib/supabase/admin";

function zonePolygon(value: unknown): Polygon | null {
  if (!Array.isArray(value)) return null;
  const points = value.flatMap((point) => (
    Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number"
      ? [{ x: point[0], y: point[1] }]
      : []
  ));
  return points.length >= 3 ? points : null;
}

function jitter(value: number): number {
  return Math.max(0, Math.min(1000, value + (Math.random() * 12 - 6)));
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body) || !("zone_id" in body) || typeof body.zone_id !== "string") {
      return NextResponse.json({ error: "zone_id must be a string" }, { status: 400 });
    }

    const profile = await requireRole("worker");
    const admin = createAdminClient();
    const [{ data: zone, error: zoneError }, { data: worker, error: workerError }] = await Promise.all([
      admin.from("zones").select("id, name, polygon, risk_level").eq("id", body.zone_id).eq("org_id", profile.org_id).eq("site_id", profile.site_id).maybeSingle(),
      admin.from("profiles").select("full_name, supervisor_id").eq("id", profile.id).eq("org_id", profile.org_id).eq("site_id", profile.site_id).single(),
    ]);
    if (zoneError || !zone) return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    if (workerError || !worker) return NextResponse.json({ error: "Worker profile not found" }, { status: 404 });

    const polygon = zonePolygon(zone.polygon);
    if (!polygon) return NextResponse.json({ error: "Zone has an invalid polygon" }, { status: 500 });
    const center = centroid(polygon);
    const now = new Date().toISOString();
    const { data: authorization, error: authorizationError } = await admin
      .from("zone_authorizations")
      .select("profile_id")
      .eq("profile_id", profile.id)
      .eq("zone_id", zone.id)
      .maybeSingle();
    if (authorizationError) return NextResponse.json({ error: "Unable to check zone authorization" }, { status: 500 });
    const authorized = authorization !== null;

    const [positionResult, eventResult] = await Promise.all([
      admin.from("worker_positions").upsert({
        profile_id: profile.id,
        org_id: profile.org_id,
        site_id: profile.site_id,
        x: jitter(center.x),
        y: jitter(center.y),
        zone_id: zone.id,
        on_shift: true,
        last_heartbeat_at: now,
        last_motion_at: now,
        updated_at: now,
      }),
      admin.from("zone_events").insert({ org_id: profile.org_id, site_id: profile.site_id, profile_id: profile.id, zone_id: zone.id, authorized }),
    ]);
    if (positionResult.error || eventResult.error) return NextResponse.json({ error: "Unable to record zone entry" }, { status: 500 });

    const { error: resolveError } = await admin
      .from("alerts")
      .update({ status: "resolved", resolved_at: now })
      .eq("org_id", profile.org_id)
      .eq("site_id", profile.site_id)
      .eq("subject_id", profile.id)
      .eq("type", "unauthorized_zone")
      .eq("status", "open")
      .neq("zone_id", zone.id);
    if (resolveError) throw resolveError;

    let alertId: string | null = null;
    if (!authorized) {
      const alert = await createAlert({
        type: "unauthorized_zone",
        severity: zone.risk_level,
        siteId: profile.site_id,
        subjectId: profile.id,
        zoneId: zone.id,
        message: `${worker.full_name} entered ${zone.name} without authorization`,
        recipients: [
          { profileId: profile.id, reason: "subject" },
          ...(worker.supervisor_id ? [{ profileId: worker.supervisor_id, reason: "supervisor" as const }] : []),
        ],
      });
      alertId = alert.id;
    }

    return NextResponse.json({ ok: true, authorized, zoneName: zone.name, alertId });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
