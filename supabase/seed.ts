import { createAdminClient } from "../lib/supabase/admin";

const password = "123456";
const emailSuffix = "@demo.safesite.local";

type SiteSeed = {
  key: "plantA" | "warehouseB";
  name: string;
  floorplan: string;
  zones: Array<{ key: string; name: string; risk: "low" | "medium" | "high"; polygon: number[][] }>;
  equipment: Array<{ name: string; department: string; x: number; y: number }>;
};

const sites: SiteSeed[] = [
  {
    key: "plantA",
    name: "Plant A – Manufacturing",
    floorplan: "/floorplans/plant-a.svg",
    zones: [
      { key: "assembly", name: "Assembly", risk: "low", polygon: [[60, 100], [450, 100], [450, 480], [60, 480]] },
      { key: "loading-dock", name: "Loading Dock", risk: "medium", polygon: [[500, 100], [940, 100], [940, 330], [500, 330]] },
      { key: "high-voltage", name: "High Voltage Room", risk: "high", polygon: [[500, 380], [700, 380], [700, 650], [500, 650]] },
      { key: "paint-booth", name: "Paint Booth", risk: "high", polygon: [[740, 380], [940, 380], [940, 650], [740, 650]] },
    ],
    equipment: [
      { name: "Conveyor 3", department: "Production", x: 260, y: 290 },
      { name: "Press 1", department: "Maintenance", x: 400, y: 400 },
      { name: "Forklift 2", department: "Loading", x: 770, y: 220 },
      { name: "Packaging Line", department: "Production", x: 350, y: 430 },
    ],
  },
  {
    key: "warehouseB",
    name: "Warehouse B",
    floorplan: "/floorplans/warehouse-b.svg",
    zones: [
      { key: "racking", name: "Racking", risk: "medium", polygon: [[60, 100], [620, 100], [620, 610], [60, 610]] },
      { key: "cold-storage", name: "Cold Storage", risk: "medium", polygon: [[660, 100], [940, 100], [940, 360], [660, 360]] },
      { key: "battery-charging", name: "Battery Charging", risk: "high", polygon: [[660, 410], [940, 410], [940, 650], [660, 650]] },
    ],
    equipment: [
      { name: "Reach Truck 1", department: "Warehouse", x: 300, y: 340 },
      { name: "Cold Room Compressor", department: "Maintenance", x: 800, y: 230 },
      { name: "Charging Station 1", department: "Warehouse", x: 800, y: 530 },
    ],
  },
];

type UserSeed = {
  employeeId: string;
  fullName: string;
  role: "admin" | "manager" | "supervisor" | "worker";
  site: SiteSeed["key"];
  department: string;
  supervisor?: string;
  simulated: boolean;
  zones: string[];
  position: [number, number];
};

const users: UserSeed[] = [
  { employeeId: "admin", fullName: "Demo Admin", role: "admin", site: "plantA", department: "Operations", simulated: false, zones: [], position: [70, 70] },
  { employeeId: "supervisor-maint", fullName: "Morgan Lee", role: "supervisor", site: "plantA", department: "Maintenance", simulated: false, zones: [], position: [180, 180] },
  { employeeId: "supervisor-prod", fullName: "Riley Chen", role: "supervisor", site: "plantA", department: "Production", simulated: false, zones: [], position: [350, 180] },
  { employeeId: "supervisor-warehouse", fullName: "Jordan Patel", role: "supervisor", site: "warehouseB", department: "Warehouse", simulated: false, zones: [], position: [220, 200] },
  { employeeId: "worker-001", fullName: "Avery Brooks", role: "worker", site: "plantA", department: "Production", supervisor: "supervisor-prod", simulated: false, zones: ["assembly", "loading-dock"], position: [140, 250] },
  { employeeId: "worker-002", fullName: "Casey Rivera", role: "worker", site: "plantA", department: "Maintenance", supervisor: "supervisor-maint", simulated: false, zones: ["assembly", "loading-dock"], position: [220, 330] },
  { employeeId: "worker-003", fullName: "Taylor Kim", role: "worker", site: "plantA", department: "Production", supervisor: "supervisor-prod", simulated: false, zones: ["assembly", "loading-dock"], position: [310, 260] },
  ...Array.from({ length: 8 }, (_, i): UserSeed => ({
    employeeId: `sim-a-${String(i + 1).padStart(2, "0")}`,
    fullName: `Sim Worker A${String(i + 1).padStart(2, "0")}`,
    role: "worker",
    site: "plantA",
    department: i % 2 === 0 ? "Production" : "Maintenance",
    supervisor: i % 2 === 0 ? "supervisor-prod" : "supervisor-maint",
    simulated: true,
    zones: ["assembly", "loading-dock"],
    position: [100 + ((i * 83) % 380), 140 + ((i * 47) % 280)],
  })),
  ...Array.from({ length: 7 }, (_, i): UserSeed => ({
    employeeId: `sim-b-${String(i + 1).padStart(2, "0")}`,
    fullName: `Sim Worker B${String(i + 1).padStart(2, "0")}`,
    role: "worker",
    site: "warehouseB",
    department: "Warehouse",
    supervisor: "supervisor-warehouse",
    simulated: true,
    zones: ["racking", "cold-storage"],
    position: [100 + ((i * 79) % 480), 150 + ((i * 53) % 390)],
  })),
];

async function main(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  }

  const supabase = createAdminClient();
  const { data: organization, error: orgReadError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", "demo")
    .maybeSingle();
  if (orgReadError) throw orgReadError;

  if (organization) {
    await deleteDemoRows(supabase, organization.id);
  }

  await deleteDemoAuthUsers(supabase);

  const { data: newOrg, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: "Demo Manufacturing Co.", slug: "demo" })
    .select("id")
    .single();
  if (orgError) throw orgError;

  const siteIds = new Map<SiteSeed["key"], string>();
  const zoneIds = new Map<string, string>();
  for (const site of sites) {
    const { data, error } = await supabase.from("sites").insert({
      org_id: newOrg.id,
      name: site.name,
      floorplan_url: site.floorplan,
      meters_per_unit: 0.05,
    }).select("id").single();
    if (error) throw error;
    siteIds.set(site.key, data.id);

    for (const zoneSeed of site.zones) {
      const { data: zone, error: zoneError } = await supabase.from("zones").insert({
        org_id: newOrg.id,
        site_id: data.id,
        name: zoneSeed.name,
        polygon: zoneSeed.polygon,
        risk_level: zoneSeed.risk,
      }).select("id").single();
      if (zoneError) throw zoneError;
      zoneIds.set(zoneSeed.key, zone.id);
    }

    const { error: equipmentError } = await supabase.from("equipment").insert(
      site.equipment.map((item) => ({ ...item, org_id: newOrg.id, site_id: data.id })),
    );
    if (equipmentError) throw equipmentError;
  }

  const profileIds = new Map<string, string>();
  for (const user of users) {
    const email = `${user.employeeId}${emailSuffix}`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { employee_id: user.employeeId, org_slug: "demo" },
    });
    if (error) throw error;
    profileIds.set(user.employeeId, data.user.id);
  }

  const profileRows = users.map((user) => ({
    id: profileIds.get(user.employeeId)!,
    org_id: newOrg.id,
    site_id: siteIds.get(user.site)!,
    employee_id: user.employeeId,
    full_name: user.fullName,
    role: user.role,
    department: user.department,
    supervisor_id: user.supervisor ? profileIds.get(user.supervisor)! : null,
    active: true,
    is_simulated: user.simulated,
  }));
  const { error: profilesError } = await supabase.from("profiles").insert(profileRows);
  if (profilesError) throw profilesError;

  const authorizations = users.flatMap((user) => user.zones.map((zoneKey) => ({
    profile_id: profileIds.get(user.employeeId)!,
    zone_id: zoneIds.get(zoneKey)!,
  })));
  const { error: authzError } = await supabase.from("zone_authorizations").insert(authorizations);
  if (authzError) throw authzError;

  const positions = users.map((user) => ({
    profile_id: profileIds.get(user.employeeId)!,
    org_id: newOrg.id,
    site_id: siteIds.get(user.site)!,
    x: user.position[0],
    y: user.position[1],
    zone_id: zoneIds.get(user.zones[0] ?? (user.site === "plantA" ? "assembly" : "racking"))!,
    on_shift: user.simulated,
    last_heartbeat_at: user.simulated ? new Date().toISOString() : null,
    last_motion_at: user.simulated ? new Date().toISOString() : null,
    status: "ok" as const,
    updated_at: new Date().toISOString(),
  }));
  const { error: positionsError } = await supabase.from("worker_positions").insert(positions);
  if (positionsError) throw positionsError;

  console.log(`Seeded ${users.length} users, 2 sites, ${zoneIds.size} zones, and demo equipment.`);
}

async function deleteDemoRows(client: ReturnType<typeof createAdminClient>, orgId: string): Promise<void> {
  const { data: profileRows, error: profileReadError } = await client.from("profiles").select("id").eq("org_id", orgId);
  if (profileReadError) throw profileReadError;
  const profileIds = (profileRows ?? []).map((row) => row.id);
  const { data: siteRows, error: siteReadError } = await client.from("sites").select("id").eq("org_id", orgId);
  if (siteReadError) throw siteReadError;
  const siteIds = (siteRows ?? []).map((row) => row.id);
  const { data: ticketRows, error: ticketReadError } = await client.from("loto_tickets").select("id").eq("org_id", orgId);
  if (ticketReadError) throw ticketReadError;
  const ticketIds = (ticketRows ?? []).map((row) => row.id);
  const { data: alertRows, error: alertReadError } = await client.from("alerts").select("id").eq("org_id", orgId);
  if (alertReadError) throw alertReadError;
  const alertIds = (alertRows ?? []).map((row) => row.id);

  const remove = async (table: string, operation: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await operation;
    if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
  };
  if (alertIds.length) await remove("alert_recipients", client.from("alert_recipients").delete().in("alert_id", alertIds));
  await remove("alerts", client.from("alerts").delete().eq("org_id", orgId));
  if (ticketIds.length) await remove("loto_events", client.from("loto_events").delete().in("ticket_id", ticketIds));
  await remove("loto_tickets", client.from("loto_tickets").delete().eq("org_id", orgId));
  await remove("zone_events", client.from("zone_events").delete().eq("org_id", orgId));
  await remove("worker_positions", client.from("worker_positions").delete().eq("org_id", orgId));
  if (profileIds.length) await remove("zone_authorizations", client.from("zone_authorizations").delete().in("profile_id", profileIds));
  await remove("equipment", client.from("equipment").delete().eq("org_id", orgId));
  await remove("zones", client.from("zones").delete().eq("org_id", orgId));
  await remove("profiles", client.from("profiles").delete().eq("org_id", orgId));
  await remove("sites", client.from("sites").delete().eq("org_id", orgId));
  await remove("organizations", client.from("organizations").delete().eq("id", orgId));
}

async function deleteDemoAuthUsers(client: ReturnType<typeof createAdminClient>): Promise<void> {
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const matches = data.users.filter((user) => user.email?.endsWith(emailSuffix));
    for (const user of matches) {
      const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
      if (deleteError) throw deleteError;
    }
    if (data.users.length < 1000) break;
    page += 1;
  }
}

void main().catch((error: unknown) => {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
});
