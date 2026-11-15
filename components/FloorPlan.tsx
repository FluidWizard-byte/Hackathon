"use client";

import { useState } from "react";

import type { SiteRealtimeData, WorkerPosition } from "@/lib/realtime";

export type FloorPlanZone = {
  id: string;
  name: string;
  polygon: readonly (readonly [number, number])[];
  risk_level: "low" | "medium" | "high";
};

type FloorPlanProps = {
  floorplanUrl: string | null;
  zones: readonly FloorPlanZone[];
  realtime: Pick<SiteRealtimeData, "workerPositions" | "equipment" | "alerts" | "alertRecipients" | "loading" | "error">;
};

const riskStyles = {
  low: "fill-emerald-500/20 stroke-emerald-400",
  medium: "fill-amber-500/20 stroke-amber-400",
  high: "fill-red-500/20 stroke-red-400",
};

const workerStyles = {
  ok: "fill-emerald-500 stroke-emerald-200",
  check: "fill-amber-400 stroke-amber-100",
  alert: "fill-red-500 stroke-red-100",
};

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function heartbeatLabel(value: string | null): string {
  if (!value) return "No heartbeat";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export function FloorPlan({ floorplanUrl, zones, realtime }: FloorPlanProps) {
  const { workerPositions, equipment, alerts, alertRecipients, loading, error } = realtime;
  const [selectedWorker, setSelectedWorker] = useState<WorkerPosition | null>(null);
  const selectedZone = zones.find((zone) => zone.id === selectedWorker?.zone_id);
  const emergencyAlerts = alerts.filter(
    (alert) =>
      alert.status === "open" &&
      alert.subject_id !== null &&
      (alert.type === "no_response" || alert.type === "no_heartbeat" || alert.type === "sos"),
  );
  const emergencyAlertsById = new Map(emergencyAlerts.map((alert) => [alert.id, alert]));
  const workerById = new Map(workerPositions.map((worker) => [worker.profile_id, worker]));
  const alertSubjectIds = new Set(emergencyAlerts.flatMap((alert) => alert.subject_id ? [alert.subject_id] : []));
  const respondingWorkerIds = new Set(
    alertRecipients
      .filter((recipient) => recipient.responded && emergencyAlertsById.has(recipient.alert_id))
      .map((recipient) => recipient.profile_id),
  );
  const responderLines = alertRecipients.flatMap((recipient) => {
    if (!recipient.responded) return [];
    const alert = emergencyAlertsById.get(recipient.alert_id);
    const responder = workerById.get(recipient.profile_id);
    const subject = alert?.subject_id ? workerById.get(alert.subject_id) : undefined;
    return alert && responder && subject && responder.profile_id !== subject.profile_id ? [{ alertId: alert.id, responder, subject }] : [];
  });
  const responderCountLabels = emergencyAlerts.flatMap((alert) => {
    const subject = alert.subject_id ? workerById.get(alert.subject_id) : undefined;
    if (!subject) return [];
    const count = alertRecipients.filter((recipient) => recipient.alert_id === alert.id && recipient.responded).length;
    return [{ alertId: alert.id, subject, count }];
  });

  return (
    <section className="relative h-full min-h-[32rem] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
      <svg className="h-full w-full" viewBox="0 0 1000 1000" role="img" aria-label="Live site floor plan">
        <rect width="1000" height="1000" className="fill-slate-900" />
        {floorplanUrl ? <image href={floorplanUrl} x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" opacity="0.7" /> : null}

        {zones.map((zone) => {
          const unauthorized = alerts.some(
            (alert) =>
              alert.type === "unauthorized_zone" &&
              alert.status === "open" &&
              alert.zone_id === zone.id &&
              alert.subject_id !== null &&
              workerById.get(alert.subject_id)?.zone_id === zone.id,
          );
          return (
          <g key={zone.id}>
            <polygon points={zone.polygon.map(([x, y]) => `${x},${y}`).join(" ")} className={unauthorized ? "animate-pulse fill-red-600/40 stroke-red-200 stroke-[5px]" : `${riskStyles[zone.risk_level]} stroke-2`} />
            <text x={zone.polygon[0]?.[0] ?? 0} y={(zone.polygon[0]?.[1] ?? 0) - 12} className="fill-slate-100 text-[22px] font-semibold drop-shadow">
              {zone.name}
            </text>
          </g>
          );
        })}

        {responderLines.map(({ alertId, responder, subject }) => (
          <line
            key={`${alertId}:${responder.profile_id}`}
            x1={responder.x}
            y1={responder.y}
            x2={subject.x}
            y2={subject.y}
            className="stroke-amber-300"
            strokeWidth="7"
            strokeDasharray="14 9"
          />
        ))}

        {responderCountLabels.map(({ alertId, subject, count }) => (
          <text key={`${alertId}:responders`} x={subject.x + 28} y={subject.y - 28} className="fill-amber-200 text-[16px] font-bold drop-shadow">
            {count} responding
          </text>
        ))}

        {equipment.map((item) => (
          <g key={item.id} transform={`translate(${item.x} ${item.y})`} aria-label={`${item.name}: ${item.status}`}>
            <rect x="-18" y="-18" width="36" height="36" rx="6" className={item.status === "locked_out" ? "fill-red-600 stroke-red-200" : "fill-slate-700 stroke-slate-300"} strokeWidth="3" />
            <text textAnchor="middle" y="8" className="fill-white text-[24px]">{item.status === "locked_out" ? "🔒" : "⚙"}</text>
          </g>
        ))}

        {workerPositions.filter((worker) => worker.on_shift).map((worker) => {
          const name = worker.profiles?.full_name ?? "Unknown worker";
          const dotStyle = alertSubjectIds.has(worker.profile_id)
            ? "animate-pulse fill-red-500 stroke-red-100"
            : respondingWorkerIds.has(worker.profile_id)
              ? "fill-amber-300 stroke-amber-50"
              : workerStyles[worker.status];
          return (
            <g
              key={worker.profile_id}
              transform={`translate(${worker.x} ${worker.y})`}
              className="cursor-pointer"
              style={{ transition: "transform 700ms ease-out" }}
              onClick={() => setSelectedWorker(worker)}
              role="button"
              tabIndex={0}
              aria-label={`Show details for ${name}`}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedWorker(worker); }}
            >
              <circle r="22" className={dotStyle} strokeWidth="3" />
              <text textAnchor="middle" y="6" className="pointer-events-none fill-slate-950 text-[15px] font-bold">{initials(name)}</text>
            </g>
          );
        })}

        {selectedWorker ? (
          <g transform={`translate(${Math.min(selectedWorker.x + 28, 700)} ${Math.max(selectedWorker.y - 130, 12)})`}>
            <rect width="280" height="122" rx="10" className="fill-slate-800 stroke-slate-500" strokeWidth="2" />
            <text x="16" y="28" className="fill-white text-[19px] font-bold">{selectedWorker.profiles?.full_name ?? "Unknown worker"}</text>
            <text x="16" y="52" className="fill-slate-300 text-[15px]">{selectedWorker.profiles?.role ?? "worker"} · {selectedZone?.name ?? "No zone"}</text>
            <text x="16" y="77" className="fill-slate-300 text-[15px]">Heartbeat: {heartbeatLabel(selectedWorker.last_heartbeat_at)}</text>
            <text x="16" y="104" className="fill-sky-300 text-[14px]">Click another worker to inspect</text>
          </g>
        ) : null}
      </svg>

      {loading ? <p className="absolute left-4 top-4 rounded bg-slate-800/90 px-3 py-2 text-sm text-slate-200">Loading live site…</p> : null}
      {error ? <p className="absolute bottom-4 left-4 rounded bg-red-950/90 px-3 py-2 text-sm text-red-200">Could not load live updates: {error}</p> : null}
    </section>
  );
}
