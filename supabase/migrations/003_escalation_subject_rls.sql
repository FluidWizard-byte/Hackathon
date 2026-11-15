-- 003: escalation subjects can view their own alert and its responder state.

create or replace function public.is_escalation_alert_subject(p_alert_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.alerts
    where id = p_alert_id
      and subject_id = auth.uid()
      and type in ('no_response', 'no_heartbeat', 'sos')
  )
$$;

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts
for select using (
  (public.auth_role() in ('admin', 'manager') and org_id = public.auth_org())
  or (public.auth_role() = 'supervisor' and site_id = public.auth_site())
  or (public.auth_role() = 'worker' and (
    public.is_alert_recipient(id)
    or public.is_escalation_alert_subject(id)
  ))
);

drop policy if exists alert_recipients_select on public.alert_recipients;
create policy alert_recipients_select on public.alert_recipients
for select using (
  (public.auth_role() = 'worker' and (
    profile_id = auth.uid()
    or public.is_escalation_alert_subject(alert_id)
  ))
  or public.can_view_alert_scope(alert_id)
);
