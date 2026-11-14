-- 002: fix alerts <-> alert_recipients RLS recursion, ignore inactive users,
--      cascade profile deletion from auth.users.
-- Safe to run once on a database that already has 001_init.sql applied.

-- 1) Helpers ignore deactivated users
create or replace function public.auth_org()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.auth_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.auth_site()
returns uuid language sql stable security definer set search_path = public as $$
  select site_id from public.profiles where id = auth.uid() and active
$$;

-- 2) Helpers that read alerts/recipients without triggering their RLS (breaks the loop)
create or replace function public.is_alert_recipient(p_alert_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.alert_recipients
    where alert_id = p_alert_id and profile_id = auth.uid()
  )
$$;

create or replace function public.can_view_alert_scope(p_alert_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.alerts a
    where a.id = p_alert_id
      and (
        (public.auth_role() in ('admin', 'manager') and a.org_id = public.auth_org())
        or (public.auth_role() = 'supervisor' and a.site_id = public.auth_site())
      )
  )
$$;

-- 3) Replace the two recursive policies
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() = 'supervisor' and site_id = public.auth_site())
  or (public.auth_role() = 'worker' and public.is_alert_recipient(id))
);

drop policy if exists alert_recipients_select on public.alert_recipients;
create policy alert_recipients_select on public.alert_recipients
for select using (
  (public.auth_role() = 'worker' and profile_id = auth.uid())
  or public.can_view_alert_scope(alert_id)
);

-- 4) Deleting an auth user deletes their profile
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
