"use client";

import { useState } from "react";

import { useSiteRealtime, type WorkerPosition } from "@/lib/realtime";

export type FloorPlanZone = {
  id: string;
  name: string;
  polygon: readonly (readonly [number, number])[];
  risk_level: "low" | "medium" | "high";
};

type FloorPlanProps = {
  siteId: string;
  floorplanUrl: string | null;
  zones: readonly FloorPlanZone[];
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

export function FloorPlan({ siteId, floorplanUrl, zones }: FloorPlanProps) {
  const { workerPositions, equipment, loading, error } = useSiteRealtime(siteId);
  const [selectedWorker, setSelectedWorker] = useState<WorkerPosition | null>(null);
  const selectedZone = zones.find((zone) => zone.id === selectedWorker?.zone_id);

  return (
    <section className="relative h-full min-h-[32rem] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
      <svg className="h-full w-full" viewBox="0 0 1000 1000" role="img" aria-label="Live site floor plan">
        <rect width="1000" height="1000" className="fill-slate-900" />
        {floorplanUrl ? <image href={floorplanUrl} x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" opacity="0.7" /> : null}

        {zones.map((zone) => (
          <g key={zone.id}>
            <polygon points={zone.polygon.map(([x, y]) => `${x},${y}`).join(" ")} className={`${riskStyles[zone.risk_level]} stroke-2`} />
            <text x={zone.polygon[0]?.[0] ?? 0} y={(zone.polygon[0]?.[1] ?? 0) - 12} className="fill-slate-100 text-[22px] font-semibold drop-shadow">
              {zone.name}
            </text>
          </g>
        ))}

        {equipment.map((item) => (
          <g key={item.id} transform={`translate(${item.x} ${item.y})`} aria-label={`${item.name}: ${item.status}`}>
            <rect x="-18" y="-18" width="36" height="36" rx="6" className={item.status === "locked_out" ? "fill-red-600 stroke-red-200" : "fill-slate-700 stroke-slate-300"} strokeWidth="3" />
            <text textAnchor="middle" y="8" className="fill-white text-[24px]">{item.status === "locked_out" ? "🔒" : "⚙"}</text>
          </g>
        ))}

        {workerPositions.filter((worker) => worker.on_shift).map((worker) => {
          const name = worker.profiles?.full_name ?? "Unknown worker";
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
              <circle r="22" className={workerStyles[worker.status]} strokeWidth="3" />
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
