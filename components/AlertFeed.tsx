"use client";

import { useEffect, useMemo, useState } from "react";

import type { FloorPlanZone } from "@/components/FloorPlan";
import type { SiteRealtimeData, WorkerRole } from "@/lib/realtime";

type AlertFeedProps = {
  role: WorkerRole;
  zones: readonly FloorPlanZone[];
  realtime: Pick<SiteRealtimeData, "alerts" | "alertRecipients" | "workerPositions" | "loading" | "error">;
};

const severityStyles = {
  low: "border-emerald-500/50 bg-emerald-950/30 text-emerald-200",
  medium: "border-amber-500/50 bg-amber-950/30 text-amber-100",
  high: "border-orange-500/50 bg-orange-950/30 text-orange-100",
  critical: "border-red-500/60 bg-red-950/50 text-red-100",
};

const alertIcons: Record<string, string> = {
  unauthorized_zone: "⛔",
  no_response: "⚠️",
  no_heartbeat: "📡",
  sos: "🆘",
  loto: "🔒",
};

function relativeAge(createdAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function resolvedAge(resolvedAt: string | null, now: number): number {
  return resolvedAt ? Math.max(0, now - new Date(resolvedAt).getTime()) : Number.POSITIVE_INFINITY;
}

function errorMessage(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return "Unable to update alert";
}

export function AlertFeed({ role, zones, realtime }: AlertFeedProps) {
  const { alerts, alertRecipients, workerPositions, loading, error } = realtime;
  const [now, setNow] = useState(() => Date.now());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canManageAlerts = role === "admin" || role === "manager" || role === "supervisor";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const workerNames = useMemo(
    () => new Map(workerPositions.map((position) => [position.profile_id, position.profiles?.full_name ?? "Unknown worker"])),
    [workerPositions],
  );
  const zoneNames = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.name])), [zones]);
  const responderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const recipient of alertRecipients) {
      if (recipient.responded) counts.set(recipient.alert_id, (counts.get(recipient.alert_id) ?? 0) + 1);
    }
    return counts;
  }, [alertRecipients]);
  const visibleAlerts = useMemo(
    () => alerts
      .filter((alert) => alert.status !== "resolved" || resolvedAge(alert.resolved_at, now) < 10_000)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [alerts, now],
  );

  async function updateAlert(id: string, action: "ack" | "resolve") {
    setPendingId(id);
    setActionError(null);
    try {
      const response = await fetch(`/api/alerts/${id}/${action}`, { method: "POST" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(errorMessage(body));
      }
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : "Unable to update alert");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" aria-label="Alert feed">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="text-lg font-bold">Alerts</h2>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300">{visibleAlerts.length}</span>
      </div>
      {actionError ? <p className="mx-3 mt-3 rounded-md bg-red-950 px-3 py-2 text-sm text-red-100">{actionError}</p> : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {loading ? <p className="text-sm text-slate-400">Loading alerts…</p> : null}
        {error ? <p className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-100">Could not load alerts: {error}</p> : null}
        {!loading && !error && visibleAlerts.length === 0 ? <p className="text-sm text-slate-400">No active alerts.</p> : null}
        {visibleAlerts.map((alert) => {
          const count = responderCounts.get(alert.id) ?? 0;
          const fading = alert.status === "resolved" && resolvedAge(alert.resolved_at, now) >= 9_000;
          const subjectName = alert.subject_id ? workerNames.get(alert.subject_id) ?? "Unknown worker" : "Site alert";
          const zoneName = alert.zone_id ? zoneNames.get(alert.zone_id) ?? "Unknown zone" : "No zone";
          const isPending = pendingId === alert.id;

          return (
            <article
              key={alert.id}
              className={`rounded-lg border p-3 transition-opacity duration-1000 ${severityStyles[alert.severity]} ${fading ? "opacity-0" : "opacity-100"}`}
            >
              <div className="flex gap-3">
                <span className="text-xl" aria-hidden="true">{alertIcons[alert.type] ?? "⚠️"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-semibold">{subjectName}</p>
                    <time className="shrink-0 text-xs opacity-80" dateTime={alert.created_at}>{relativeAge(alert.created_at, now)}</time>
                  </div>
                  <p className="mt-0.5 text-sm opacity-90">{zoneName} · {count} {count === 1 ? "responder" : "responders"}</p>
                  <p className="mt-1 text-sm opacity-90">{alert.message}</p>
                  {alert.status === "resolved" ? <p className="mt-2 text-xs font-bold uppercase tracking-wide">Resolved</p> : null}
                  {canManageAlerts && alert.status !== "resolved" ? (
                    <div className="mt-3 flex gap-2">
                      {alert.status === "open" ? (
                        <button
                          type="button"
                          className="min-h-10 rounded-md border border-current px-3 text-sm font-bold disabled:cursor-wait disabled:opacity-60"
                          disabled={isPending}
                          onClick={() => void updateAlert(alert.id, "ack")}
                        >
                          {isPending ? "Updating…" : "Acknowledge"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="min-h-10 rounded-md bg-red-600 px-3 text-sm font-bold text-white hover:bg-red-500 disabled:cursor-wait disabled:opacity-60"
                        disabled={isPending}
                        onClick={() => void updateAlert(alert.id, "resolve")}
                      >
                        {isPending ? "Updating…" : "Resolve"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
