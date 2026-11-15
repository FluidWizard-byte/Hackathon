import { createAdminClient } from "@/lib/supabase/admin";
import { createAlert } from "@/lib/alerts";
import { runNoHeartbeatWatchdog } from "@/lib/escalation-service";
import { findZoneForPoint, pointInPolygon, type Point, type Polygon, type Zone } from "@/lib/geometry";

const TICK_MS = 1_500;
const WATCHDOG_INTERVAL_MS = 5_000;
const MAX_COORDINATE = 1_000;
const STEP_SIZE = 35;

interface SimWorker {
  id: string;
  org_id: string;
  site_id: string;
  x: number;
  y: number;
  full_name: string;
  supervisor_id: string | null;
}

interface SimZone extends Zone {
  site_id: string;
  name: string;
  risk_level: "low" | "medium" | "high";
}

interface SiteBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const admin = createAdminClient();
const waypoints = new Map<string, Point>();
const siteBounds = new Map<string, SiteBounds>();
let stopping = false;
let lastWatchdogRunAt = 0;
const unauthorizedAlertTimes = new Map<string, number>();

function clamp(value: number): number {
  return Math.max(0, Math.min(MAX_COORDINATE, value));
}

function validPolygon(value: unknown): Polygon | null {
  if (!Array.isArray(value)) return null;
  const points: Point[] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2 || typeof point[0] !== "number" || typeof point[1] !== "number") {
      return null;
    }
    points.push({ x: point[0], y: point[1] });
  }
  return points.length >= 3 ? points : null;
}

function boundsFor(zones: readonly SimZone[]): SiteBounds {
  const points = zones.flatMap((zone) => zone.polygon);
  if (points.length === 0) return { minX: 0, maxX: MAX_COORDINATE, minY: 0, maxY: MAX_COORDINATE };
  return {
    minX: clamp(Math.min(...points.map((point) => point.x))),
    maxX: clamp(Math.max(...points.map((point) => point.x))),
    minY: clamp(Math.min(...points.map((point) => point.y))),
    maxY: clamp(Math.max(...points.map((point) => point.y))),
  };
}

function randomPointInZone(zone: SimZone): Point {
  const xs = zone.polygon.map((point) => point.x);
  const ys = zone.polygon.map((point) => point.y);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(MAX_COORDINATE, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(MAX_COORDINATE, Math.max(...ys));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = { x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) };
    if (pointInPolygon(candidate, zone.polygon)) return candidate;
  }
  // Degenerate/concave shapes can have an exterior centroid; use a known polygon vertex.
  return zone.polygon.find((point) => pointInPolygon(point, zone.polygon)) ?? { x: minX, y: minY };
}

function nextWaypoint(worker: SimWorker, authorizedZoneIds: ReadonlySet<string>, zones: readonly SimZone[]): Point {
  const authorizedZones = zones.filter((zone) => zone.site_id === worker.site_id && authorizedZoneIds.has(zone.id));
  if (authorizedZones.length > 0) {
    return randomPointInZone(authorizedZones[Math.floor(Math.random() * authorizedZones.length)]);
  }
  const bounds = siteBounds.get(worker.site_id) ?? { minX: 0, maxX: MAX_COORDINATE, minY: 0, maxY: MAX_COORDINATE };
  return {
    x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
    y: bounds.minY + Math.random() * (bounds.maxY - bounds.minY),
  };
}

function moveToward(current: Point, target: Point): Point {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= STEP_SIZE) return { x: clamp(target.x), y: clamp(target.y) };
  return { x: clamp(current.x + (dx / distance) * STEP_SIZE), y: clamp(current.y + (dy / distance) * STEP_SIZE) };
}

export async function runWatchdog(): Promise<void> {
  if (Date.now() - lastWatchdogRunAt < WATCHDOG_INTERVAL_MS) return;
  lastWatchdogRunAt = Date.now();
  const escalated = await runNoHeartbeatWatchdog();
  if (escalated > 0) console.log(`[sim] Watchdog escalated ${escalated} worker${escalated === 1 ? "" : "s"}`);
}

async function tick(): Promise<void> {
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, org_id, site_id, full_name, supervisor_id")
    .eq("is_simulated", true)
    .eq("active", true);
  if (profileError) throw profileError;

  const profileRows = profiles ?? [];
  const ids = profileRows.map((profile) => profile.id);
  const [positionResult, zoneResult, authResult] = await Promise.all([
    admin.from("worker_positions").select("profile_id, org_id, site_id, x, y, zone_id").in("profile_id", ids),
    admin.from("zones").select("id, site_id, name, risk_level, polygon"),
    admin.from("zone_authorizations").select("profile_id, zone_id").in("profile_id", ids),
  ]);
  if (positionResult.error) throw positionResult.error;
  if (zoneResult.error) throw zoneResult.error;
  if (authResult.error) throw authResult.error;

  const positionsById = new Map((positionResult.data ?? []).map((position) => [position.profile_id, position]));
  const zones: SimZone[] = (zoneResult.data ?? []).flatMap((row) => {
    const polygon = validPolygon(row.polygon);
    return polygon ? [{ id: row.id, site_id: row.site_id, name: row.name, risk_level: row.risk_level, polygon }] : [];
  });
  const zonesBySite = new Map<string, SimZone[]>();
  for (const zone of zones) zonesBySite.set(zone.site_id, [...(zonesBySite.get(zone.site_id) ?? []), zone]);
  for (const [siteId, siteZones] of zonesBySite) siteBounds.set(siteId, boundsFor(siteZones));

  const authorizedByProfile = new Map<string, Set<string>>();
  for (const authorization of authResult.data ?? []) {
    const authorized = authorizedByProfile.get(authorization.profile_id) ?? new Set<string>();
    authorized.add(authorization.zone_id);
    authorizedByProfile.set(authorization.profile_id, authorized);
  }

  const now = new Date().toISOString();
  let movedWorkers = 0;
  for (const profile of profileRows) {
    const position = positionsById.get(profile.id);
    if (!position) continue;
    const worker: SimWorker = { id: profile.id, org_id: profile.org_id, site_id: profile.site_id, x: Number(position.x), y: Number(position.y), full_name: profile.full_name, supervisor_id: profile.supervisor_id };
    let target = waypoints.get(worker.id);
    if (!target || Math.hypot(target.x - worker.x, target.y - worker.y) <= STEP_SIZE) {
      target = nextWaypoint(worker, authorizedByProfile.get(worker.id) ?? new Set(), zones);
      waypoints.set(worker.id, target);
    }
    const point = moveToward(worker, target);
    const zone = findZoneForPoint(point, zonesBySite.get(worker.site_id) ?? []) as SimZone | undefined;
    const { error } = await admin.from("worker_positions").update({
      x: point.x,
      y: point.y,
      zone_id: zone?.id ?? null,
      last_heartbeat_at: now,
      last_motion_at: now,
      updated_at: now,
      on_shift: true,
    }).eq("profile_id", worker.id).eq("org_id", worker.org_id).eq("site_id", worker.site_id);
    if (error) throw error;
    if (position.zone_id !== (zone?.id ?? null)) {
      let resolveQuery = admin
        .from("alerts")
        .update({ status: "resolved", resolved_at: now })
        .eq("org_id", worker.org_id)
        .eq("site_id", worker.site_id)
        .eq("subject_id", worker.id)
        .eq("type", "unauthorized_zone")
        .eq("status", "open");
      if (zone) resolveQuery = resolveQuery.neq("zone_id", zone.id);
      const { error: resolveError } = await resolveQuery;
      if (resolveError) throw resolveError;
    }
    if (zone && !authorizedByProfile.get(worker.id)?.has(zone.id)) {
      const throttleKey = `${worker.id}:${zone.id}`;
      const lastAlertAt = unauthorizedAlertTimes.get(throttleKey) ?? 0;
      if (Date.now() - lastAlertAt >= 60_000) {
        await createAlert({
          type: "unauthorized_zone",
          severity: zone.risk_level,
          siteId: worker.site_id,
          subjectId: worker.id,
          zoneId: zone.id,
          message: `${worker.full_name} entered ${zone.name} without authorization`,
          recipients: [
            { profileId: worker.id, reason: "subject" },
            ...(worker.supervisor_id ? [{ profileId: worker.supervisor_id, reason: "supervisor" as const }] : []),
          ],
        });
        unauthorizedAlertTimes.set(throttleKey, Date.now());
      }
    }
    movedWorkers += 1;
  }

  let movedForklifts = 0;
  if (Math.random() < 0.2) {
    const { data: forklifts, error } = await admin.from("equipment")
      .select("id, org_id, site_id, x, y")
      .ilike("name", "%forklift%");
    if (error) throw error;
    const forklift = forklifts?.[Math.floor(Math.random() * (forklifts.length || 1))];
    if (forklift) {
      const bounds = siteBounds.get(forklift.site_id) ?? { minX: 0, maxX: MAX_COORDINATE, minY: 0, maxY: MAX_COORDINATE };
      const { error: updateError } = await admin.from("equipment").update({
        x: clamp(Number(forklift.x) + (Math.random() * 120 - 60)),
        y: clamp(Number(forklift.y) + (Math.random() * 120 - 60)),
      }).eq("id", forklift.id).eq("org_id", forklift.org_id).eq("site_id", forklift.site_id);
      if (updateError) throw updateError;
      // Keep site bounds available when a site has no zones.
      siteBounds.set(forklift.site_id, bounds);
      movedForklifts = 1;
    }
  }

  console.log(`[sim] ${new Date().toLocaleTimeString()} moved ${movedWorkers} workers${movedForklifts ? " and a forklift" : ""}`);
}

async function main(): Promise<void> {
  console.log("[sim] Starting simulator (Ctrl+C to stop)");
  while (!stopping) {
    const startedAt = Date.now();
    try {
      await tick();
      await runWatchdog();
    } catch (error) {
      console.error("[sim] Tick failed:", error);
    }
    const remaining = Math.max(0, TICK_MS - (Date.now() - startedAt));
    if (!stopping) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
  console.log("[sim] Stopped cleanly");
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

void main().catch((error: unknown) => {
  console.error("[sim] Fatal error:", error);
  process.exitCode = 1;
});
