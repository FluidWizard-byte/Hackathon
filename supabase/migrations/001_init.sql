create extension if not exists "pgcrypto";

create type public.user_role as enum ('admin', 'manager', 'supervisor', 'worker');
create type public.risk_level as enum ('low', 'medium', 'high');
create type public.equipment_status as enum ('operational', 'locked_out');
create type public.worker_status as enum ('ok', 'check', 'alert');
create type public.severity_level as enum ('low', 'medium', 'high', 'critical');
create type public.loto_status as enum ('reported', 'locked_out', 'verified', 'released');
create type public.alert_type as enum ('unauthorized_zone', 'no_response', 'no_heartbeat', 'sos', 'loto');
create type public.alert_status as enum ('open', 'acknowledged', 'resolved');
create type public.alert_recipient_reason as enum ('subject', 'supervisor', 'department', 'nearby');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  floorplan_url text,
  meters_per_unit numeric not null default 0.05,
  created_at timestamptz not null default now()
);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  name text not null,
  polygon jsonb not null,
  risk_level public.risk_level not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id),
  org_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  employee_id text not null,
  full_name text not null,
  role public.user_role not null,
  department text,
  supervisor_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  is_simulated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, employee_id)
);

create table public.zone_authorizations (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  zone_id uuid not null references public.zones(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, zone_id)
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  name text not null,
  department text not null,
  x numeric not null,
  y numeric not null,
  status public.equipment_status not null default 'operational',
  created_at timestamptz not null default now()
);

create table public.worker_positions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  x numeric not null,
  y numeric not null,
  zone_id uuid references public.zones(id) on delete set null,
  on_shift boolean not null default false,
  last_heartbeat_at timestamptz,
  last_motion_at timestamptz,
  status public.worker_status not null default 'ok',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.zone_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  profile_id uuid not null references public.profiles(id),
  zone_id uuid not null references public.zones(id),
  authorized boolean not null,
  created_at timestamptz not null default now()
);

create table public.loto_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  equipment_id uuid not null references public.equipment(id),
  reported_by uuid not null references public.profiles(id),
  description text,
  hazard_type text not null,
  severity public.severity_level not null,
  department text not null,
  summary text,
  status public.loto_status not null default 'reported',
  locked_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  released_by uuid references public.profiles(id) on delete set null,
  locked_at timestamptz,
  verified_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.loto_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.loto_tickets(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  note text,
  created_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  type public.alert_type not null,
  severity public.severity_level not null,
  subject_id uuid references public.profiles(id) on delete set null,
  zone_id uuid references public.zones(id) on delete set null,
  equipment_id uuid references public.equipment(id) on delete set null,
  ticket_id uuid references public.loto_tickets(id) on delete set null,
  message text not null,
  status public.alert_status not null default 'open',
  acknowledged_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.alert_recipients (
  alert_id uuid not null references public.alerts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reason public.alert_recipient_reason not null,
  responded boolean not null default false,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (alert_id, profile_id)
);

create index sites_org_id_idx on public.sites (org_id);
create index zones_org_id_idx on public.zones (org_id);
create index zones_site_id_idx on public.zones (site_id);
create index profiles_org_id_idx on public.profiles (org_id);
create index profiles_site_id_idx on public.profiles (site_id);
create index profiles_supervisor_id_idx on public.profiles (supervisor_id);
create index zone_authorizations_zone_id_idx on public.zone_authorizations (zone_id);
create index equipment_org_id_idx on public.equipment (org_id);
create index equipment_site_id_idx on public.equipment (site_id);
create index worker_positions_org_id_idx on public.worker_positions (org_id);
create index worker_positions_site_id_idx on public.worker_positions (site_id);
create index zone_events_org_id_idx on public.zone_events (org_id);
create index zone_events_site_id_idx on public.zone_events (site_id);
create index zone_events_profile_id_idx on public.zone_events (profile_id);
create index zone_events_zone_id_idx on public.zone_events (zone_id);
create index loto_tickets_org_id_idx on public.loto_tickets (org_id);
create index loto_tickets_site_id_idx on public.loto_tickets (site_id);
create index loto_tickets_equipment_id_idx on public.loto_tickets (equipment_id);
create index loto_tickets_reported_by_idx on public.loto_tickets (reported_by);
create index loto_tickets_locked_by_idx on public.loto_tickets (locked_by);
create index loto_events_ticket_id_idx on public.loto_events (ticket_id);
create index loto_events_actor_id_idx on public.loto_events (actor_id);
create index alerts_org_id_idx on public.alerts (org_id);
create index alerts_site_id_idx on public.alerts (site_id);
create index alerts_subject_id_idx on public.alerts (subject_id);
create index alerts_ticket_id_idx on public.alerts (ticket_id);
create index alert_recipients_profile_id_idx on public.alert_recipients (profile_id);

create function public.auth_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id
  from public.profiles
  where id = auth.uid()
$$;

create function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

create function public.auth_site()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select site_id
  from public.profiles
  where id = auth.uid()
$$;

alter table public.organizations enable row level security;
alter table public.sites enable row level security;
alter table public.zones enable row level security;
alter table public.profiles enable row level security;
alter table public.zone_authorizations enable row level security;
alter table public.equipment enable row level security;
alter table public.worker_positions enable row level security;
alter table public.zone_events enable row level security;
alter table public.loto_tickets enable row level security;
alter table public.loto_events enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_recipients enable row level security;

create policy organizations_select on public.organizations
for select using (id = public.auth_org());

create policy sites_select on public.sites
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() in ('supervisor', 'worker') and id = public.auth_site())
);

create policy zones_select on public.zones
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() in ('supervisor', 'worker') and site_id = public.auth_site())
);

create policy profiles_select on public.profiles
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() = 'supervisor' and site_id = public.auth_site())
  or (public.auth_role() = 'worker' and id = auth.uid())
);

create policy zone_authorizations_select on public.zone_authorizations
for select using (
  exists (
    select 1
    from public.profiles
    where profiles.id = zone_authorizations.profile_id
      and (
        (public.auth_role() in ('admin', 'manager') and profiles.org_id = public.auth_org())
        or (public.auth_role() = 'supervisor' and profiles.site_id = public.auth_site())
        or (public.auth_role() = 'worker' and profiles.id = auth.uid())
      )
  )
);

create policy equipment_select on public.equipment
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() in ('supervisor', 'worker') and site_id = public.auth_site())
);

create policy worker_positions_select on public.worker_positions
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() = 'supervisor' and site_id = public.auth_site())
  or (public.auth_role() = 'worker' and profile_id = auth.uid())
);

create policy zone_events_select on public.zone_events
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() = 'supervisor' and site_id = public.auth_site())
  or (public.auth_role() = 'worker' and profile_id = auth.uid())
);

create policy loto_tickets_select on public.loto_tickets
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() = 'supervisor' and site_id = public.auth_site())
  or (public.auth_role() = 'worker' and (reported_by = auth.uid() or locked_by = auth.uid()))
);

create policy loto_events_select on public.loto_events
for select using (
  exists (
    select 1
    from public.loto_tickets
    where loto_tickets.id = loto_events.ticket_id
      and (
        (public.auth_role() in ('admin', 'manager') and loto_tickets.org_id = public.auth_org())
        or (public.auth_role() = 'supervisor' and loto_tickets.site_id = public.auth_site())
        or (public.auth_role() = 'worker' and (loto_tickets.reported_by = auth.uid() or loto_tickets.locked_by = auth.uid()))
      )
  )
);

create policy alerts_select on public.alerts
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() = 'supervisor' and site_id = public.auth_site())
  or (
    public.auth_role() = 'worker'
    and exists (
      select 1
      from public.alert_recipients
      where alert_recipients.alert_id = alerts.id
        and alert_recipients.profile_id = auth.uid()
    )
  )
);

create policy alert_recipients_select on public.alert_recipients
for select using (
  (public.auth_role() = 'worker' and profile_id = auth.uid())
  or exists (
    select 1
    from public.alerts
    where alerts.id = alert_recipients.alert_id
      and (
        (public.auth_role() in ('admin', 'manager') and alerts.org_id = public.auth_org())
        or (public.auth_role() = 'supervisor' and alerts.site_id = public.auth_site())
      )
  )
);

alter publication supabase_realtime add table
  public.worker_positions,
  public.alerts,
  public.alert_recipients,
  public.loto_tickets,
  public.equipment;
