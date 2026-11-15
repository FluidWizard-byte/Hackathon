"use client";

import { AlertFeed } from "@/components/AlertFeed";
import { FloorPlan, type FloorPlanZone } from "@/components/FloorPlan";
import { useSiteRealtime, type WorkerRole } from "@/lib/realtime";

type DashboardLiveProps = {
  siteId: string;
  floorplanUrl: string | null;
  role: WorkerRole;
  zones: readonly FloorPlanZone[];
};

export function DashboardLive({ siteId, floorplanUrl, role, zones }: DashboardLiveProps) {
  const realtime = useSiteRealtime(siteId);

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <FloorPlan floorplanUrl={floorplanUrl} zones={zones} realtime={realtime} />
      <AlertFeed role={role} zones={zones} realtime={realtime} />
    </div>
  );
}
