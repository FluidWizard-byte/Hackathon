import "server-only";

import { createAlert, type AlertType } from "@/lib/alerts";
import {
  buildEscalationMessage,
  recipientDistanceMeters,
  selectRecipients,
  type EscalationWorker,
} from "@/lib/escalation";
import { createAdminClient } from "@/lib/supabase/admin";

export type EscalationReason = Extract<AlertType, "no_response" | "no_heartbeat" | "sos">;

type ProfileRow = {
  id: string;
  full_name: string;
  supervisor_id: string | null;
  active: boolean;
  is_simulated: boolean;
  role: "admin" | "manager" | "supervisor" | "worker";
};

type PositionRow = {
  profile_id: string;
  org_id: string;
  site_id: string;
  x: number | string;
  y: number | string;
  zone_id: string | null;
  on_shift: boolean;
};

type SiteRow = { meters_per_unit: number | string };

function positionWorker(profile: ProfileRow, position: PositionRow): EscalationWorker {
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Worker ${profile.id} has invalid position coordinates`);
  }

  return {
    id: profile.id,
    x,
    y,
    active: profile.active,
    onShift: position.on_shift,
    isSimulated: profile.is_simulated,
  };
}

function nearbyCount(): number {
  const value = Number(process.env.NEARBY_COUNT);
  if (!Number.isInteger(value) || value < 0) throw new Error("NEARBY_COUNT must be a non-negative integer");
  return value;
}

/** Creates one critical escalation alert, its recipients, and the subject's alert status. */
export async function escalateWorker({
  subjectId,
  orgId,
  siteId,
  reason,
}: {
  subjectId: string;
  orgId: string;
  siteId: string;
  reason: EscalationReason;
}): Promise<{ alertId: string; message: string }> {
  const admin = createAdminClient();
  const [subjectResult, subjectPositionResult, profilesResult, positionsResult, siteResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, supervisor_id, active, is_simulated, role")
      .eq("id", subjectId)
      .eq("org_id", orgId)
      .eq("site_id", siteId)
      .maybeSingle(),
    admin
      .from("worker_positions")
      .select("profile_id, org_id, site_id, x, y, zone_id, on_shift")
      .eq("profile_id", subjectId)
      .eq("org_id", orgId)
      .eq("site_id", siteId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id, full_name, supervisor_id, active, is_simulated, role")
      .eq("org_id", orgId)
      .eq("site_id", siteId)
      .eq("role", "worker"),
    admin
      .from("worker_positions")
      .select("profile_id, org_id, site_id, x, y, zone_id, on_shift")
      .eq("org_id", orgId)
      .eq("site_id", siteId),
    admin.from("sites").select("meters_per_unit").eq("id", siteId).eq("org_id", orgId).maybeSingle(),
  ]);

  if (subjectResult.error) throw subjectResult.error;
  if (subjectPositionResult.error) throw subjectPositionResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (positionsResult.error) throw positionsResult.error;
  if (siteResult.error) throw siteResult.error;
  if (!subjectResult.data || !subjectPositionResult.data || !siteResult.data) {
    throw new Error("Escalation subject, position, or site was not found");
  }

  const subjectProfile = subjectResult.data as ProfileRow;
  const subjectPosition = subjectPositionResult.data as PositionRow;
  const subject = positionWorker(subjectProfile, subjectPosition);
  const positionByProfileId = new Map(
    ((positionsResult.data ?? []) as PositionRow[]).map((position) => [position.profile_id, position]),
  );
  const workers = ((profilesResult.data ?? []) as ProfileRow[]).flatMap((profile) => {
    const position = positionByProfileId.get(profile.id);
    return position ? [positionWorker(profile, position)] : [];
  });
  const recipients = selectRecipients(subject, workers, subjectProfile.supervisor_id, nearbyCount());
  const nearestRecipientId = recipients.find((recipient) => recipient.reason === "nearby")?.profileId;
  const nearestRecipient = workers.find((worker) => worker.id === nearestRecipientId);
  const metersPerUnit = Number((siteResult.data as SiteRow).meters_per_unit);

  let zoneName: string | null = null;
  if (subjectPosition.zone_id) {
    const { data: zone, error: zoneError } = await admin
      .from("zones")
      .select("name")
      .eq("id", subjectPosition.zone_id)
      .eq("org_id", orgId)
      .eq("site_id", siteId)
      .maybeSingle();
    if (zoneError) throw zoneError;
    zoneName = zone?.name ?? null;
  }

  const message = buildEscalationMessage(
    { fullName: subjectProfile.full_name },
    zoneName,
    recipientDistanceMeters(subject, nearestRecipient, metersPerUnit),
  );
  const alert = await createAlert({
    type: reason,
    severity: "critical",
    siteId,
    subjectId,
    zoneId: subjectPosition.zone_id ?? undefined,
    message,
    recipients,
  });
  const { error: positionUpdateError } = await admin
    .from("worker_positions")
    .update({ status: "alert", updated_at: new Date().toISOString() })
    .eq("profile_id", subjectId)
    .eq("org_id", orgId)
    .eq("site_id", siteId);
  if (positionUpdateError) throw positionUpdateError;

  return { alertId: alert.id, message };
}

/** Escalates stale on-shift real-worker heartbeats once until that worker checks in again. */
export async function runNoHeartbeatWatchdog(): Promise<number> {
  const timeoutSeconds = Number(process.env.HEARTBEAT_TIMEOUT_SECONDS);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("HEARTBEAT_TIMEOUT_SECONDS must be a positive integer");
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - timeoutSeconds * 1_000).toISOString();
  const { data: stalePositionData, error: stalePositionError } = await admin
    .from("worker_positions")
    .select("profile_id, org_id, site_id, x, y, zone_id, on_shift, last_heartbeat_at")
    .eq("on_shift", true)
    .lt("last_heartbeat_at", cutoff);
  if (stalePositionError) throw stalePositionError;

  const stalePositions = (stalePositionData ?? []) as (PositionRow & { last_heartbeat_at: string })[];
  if (stalePositions.length === 0) return 0;

  const staleIds = stalePositions.map((position) => position.profile_id);
  const [profilesResult, alertsResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id, org_id, site_id, active, is_simulated, role")
      .in("id", staleIds)
      .eq("active", true)
      .eq("is_simulated", false)
      .eq("role", "worker"),
    admin
      .from("alerts")
      .select("subject_id, created_at")
      .eq("type", "no_heartbeat")
      .in("subject_id", staleIds),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (alertsResult.error) throw alertsResult.error;

  const realProfiles = (profilesResult.data ?? []) as Array<{
    id: string;
    org_id: string;
    site_id: string;
    active: boolean;
    is_simulated: boolean;
    role: "worker";
  }>;
  const previousAlertsBySubject = new Map<string, string[]>();
  for (const alert of (alertsResult.data ?? []) as Array<{ subject_id: string | null; created_at: string }>) {
    if (!alert.subject_id) continue;
    previousAlertsBySubject.set(alert.subject_id, [...(previousAlertsBySubject.get(alert.subject_id) ?? []), alert.created_at]);
  }

  let escalated = 0;
  for (const profile of realProfiles) {
    const position = stalePositions.find((candidate) => candidate.profile_id === profile.id);
    if (!position) continue;
    const alreadyEscalated = (previousAlertsBySubject.get(profile.id) ?? []).some(
      (createdAt) => new Date(createdAt).getTime() >= new Date(position.last_heartbeat_at).getTime(),
    );
    if (alreadyEscalated) continue;

    await escalateWorker({
      subjectId: profile.id,
      orgId: profile.org_id,
      siteId: profile.site_id,
      reason: "no_heartbeat",
    });
    escalated += 1;
  }

  return escalated;
}
