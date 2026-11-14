import { FloorPlan, type FloorPlanZone } from "@/components/FloorPlan";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const profile = await requireRole("admin", "manager", "supervisor");
  const supabase = await createClient();
  const [{ data: site }, { data: zoneRows }] = await Promise.all([
    supabase.from("sites").select("id, name, floorplan_url").eq("id", profile.site_id).eq("org_id", profile.org_id).single(),
    supabase.from("zones").select("id, name, polygon, risk_level").eq("site_id", profile.site_id).eq("org_id", profile.org_id),
  ]);

  const zones = (zoneRows ?? []) as unknown as FloorPlanZone[];

  return (
    <main className="h-[calc(100vh-57px)] bg-slate-950 p-4 text-slate-50">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-300">Live site view</p>
            <h1 className="text-2xl font-bold">{site?.name ?? "Site dashboard"}</h1>
          </div>
          <span className="flex items-center gap-2 text-sm font-semibold text-emerald-300"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />Live</span>
        </div>
        <div className="min-h-0 flex-1">
          <FloorPlan siteId={profile.site_id} floorplanUrl={site?.floorplan_url ?? null} zones={zones} />
        </div>
      </div>
    </main>
  );
}
