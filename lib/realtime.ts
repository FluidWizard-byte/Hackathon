"use client";

import { useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/browser";

export type WorkerStatus = "ok" | "check" | "alert";
export type WorkerRole = "admin" | "manager" | "supervisor" | "worker";

export type WorkerPosition = {
  profile_id: string;
  site_id: string;
  x: number;
  y: number;
  zone_id: string | null;
  on_shift: boolean;
  last_heartbeat_at: string | null;
  status: WorkerStatus;
  profiles: { full_name: string; role: WorkerRole } | null;
};

export type Equipment = {
  id: string;
  site_id: string;
  name: string;
  x: number;
  y: number;
  status: "operational" | "locked_out";
};

export type Alert = {
  id: string;
  site_id: string;
  subject_id: string | null;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved";
  zone_id: string | null;
  message: string;
  resolved_at: string | null;
  created_at: string;
};

export type MyAlert = Alert & {
  alert_id: string;
  reason: "subject" | "supervisor" | "department" | "nearby";
  responded: boolean;
};

export type AlertRecipient = {
  alert_id: string;
  profile_id: string;
  responded: boolean;
  responded_at: string | null;
};

export type SubjectEscalationAlert = Alert & {
  recipients: AlertRecipient[];
};

export type LotoTicket = {
  id: string;
  site_id: string;
  equipment_id: string;
  status: "reported" | "locked_out" | "verified" | "released";
  summary: string | null;
  created_at: string;
};

export type SiteRealtimeData = {
  workerPositions: WorkerPosition[];
  equipment: Equipment[];
  alerts: Alert[];
  alertRecipients: AlertRecipient[];
  lotoTickets: LotoTicket[];
  loading: boolean;
  error: string | null;
};

const emptyData: SiteRealtimeData = {
  workerPositions: [],
  equipment: [],
  alerts: [],
  alertRecipients: [],
  lotoTickets: [],
  loading: true,
  error: null,
};

function applyChange<T extends Record<string, unknown>>(
  rows: T[],
  payload: RealtimePostgresChangesPayload<T>,
  key: keyof T,
): T[] {
  const changedRow = payload.eventType === "DELETE" ? payload.old : payload.new;
  const changedKey = changedRow[key];
  if (changedKey === undefined) return rows;

  if (payload.eventType === "DELETE") {
    return rows.filter((row) => row[key] !== changedKey);
  }

  const existingIndex = rows.findIndex((row) => row[key] === changedKey);
  if (existingIndex === -1) return [...rows, payload.new];

  return rows.map((row, index) => (index === existingIndex ? payload.new : row));
}

/** Loads one site's live dashboard data and owns all Supabase Realtime subscriptions. */
export function useSiteRealtime(siteId: string): SiteRealtimeData {
  const [data, setData] = useState<SiteRealtimeData>(emptyData);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const loadInitialData = async () => {
      const [positions, equipment, alerts, alertRecipients, lotoTickets] = await Promise.all([
        supabase
          .from("worker_positions")
          .select("profile_id, site_id, x, y, zone_id, on_shift, last_heartbeat_at, status, profiles(full_name, role)")
          .eq("site_id", siteId),
        supabase.from("equipment").select("id, site_id, name, x, y, status").eq("site_id", siteId),
        supabase
          .from("alerts")
          .select("id, site_id, subject_id, type, severity, status, zone_id, message, resolved_at, created_at")
          .eq("site_id", siteId),
        supabase
          .from("alert_recipients")
          .select("alert_id, profile_id, responded, responded_at, alerts!inner(site_id)")
          .eq("alerts.site_id", siteId),
        supabase
          .from("loto_tickets")
          .select("id, site_id, equipment_id, status, summary, created_at")
          .eq("site_id", siteId),
      ]);

      const firstError = positions.error ?? equipment.error ?? alerts.error ?? alertRecipients.error ?? lotoTickets.error;
      if (!active) return;

      setData({
        workerPositions: (positions.data ?? []) as unknown as WorkerPosition[],
        equipment: (equipment.data ?? []) as unknown as Equipment[],
        alerts: (alerts.data ?? []) as unknown as Alert[],
        alertRecipients: (alertRecipients.data ?? []) as unknown as AlertRecipient[],
        lotoTickets: (lotoTickets.data ?? []) as unknown as LotoTicket[],
        loading: false,
        error: firstError?.message ?? null,
      });
    };

    void loadInitialData();

    const channel = supabase
      .channel(`site-dashboard:${siteId}:${crypto.randomUUID()}`)
      .on<WorkerPosition>("postgres_changes", { event: "*", schema: "public", table: "worker_positions", filter: `site_id=eq.${siteId}` }, (payload) => {
        if (active) setData((current) => ({ ...current, workerPositions: applyChange(current.workerPositions, payload, "profile_id") }));
      })
      .on<Equipment>("postgres_changes", { event: "*", schema: "public", table: "equipment", filter: `site_id=eq.${siteId}` }, (payload) => {
        if (active) setData((current) => ({ ...current, equipment: applyChange(current.equipment, payload, "id") }));
      })
      .on<Alert>("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `site_id=eq.${siteId}` }, (payload) => {
        if (active) setData((current) => ({ ...current, alerts: applyChange(current.alerts, payload, "id") }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_recipients" }, () => {
        if (active) void loadInitialData();
      })
      .on<LotoTicket>("postgres_changes", { event: "*", schema: "public", table: "loto_tickets", filter: `site_id=eq.${siteId}` }, (payload) => {
        if (active) setData((current) => ({ ...current, lotoTickets: applyChange(current.lotoTickets, payload, "id") }));
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [siteId]);

  return data;
}

/** Loads the current worker's alerts and owns their recipient-scoped realtime subscription. */
export function useMyAlerts(profileId: string): { alerts: MyAlert[]; loading: boolean; error: string | null } {
  const [alerts, setAlerts] = useState<MyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!profileId) {
      setAlerts([]);
      setLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }
    const loadAlerts = async () => {
      const { data, error: loadError } = await supabase
        .from("alert_recipients")
        .select("alert_id, reason, responded, alerts(id, site_id, subject_id, type, severity, status, zone_id, message, resolved_at, created_at)")
        .eq("profile_id", profileId);
      if (!active) return;
      const rows = (data ?? []).flatMap((row) => {
        const alert = row.alerts;
        return alert && typeof alert === "object" && !Array.isArray(alert)
          ? [{ ...(alert as Alert), alert_id: row.alert_id, reason: row.reason, responded: row.responded } as MyAlert]
          : [];
      });
      setAlerts(rows);
      setLoading(false);
      setError(loadError?.message ?? null);
    };
    void loadAlerts();

    const channel = supabase.channel(`my-alerts:${profileId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_recipients", filter: `profile_id=eq.${profileId}` }, () => { void loadAlerts(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => { void loadAlerts(); })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [profileId]);

  return { alerts, loading, error };
}

/** Loads alerts where the current worker is the subject and their live responder state. */
export function useMySubjectEscalations(profileId: string): { alerts: SubjectEscalationAlert[]; loading: boolean; error: string | null } {
  const [alerts, setAlerts] = useState<SubjectEscalationAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!profileId) {
      setAlerts([]);
      setLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    const loadAlerts = async () => {
      const { data, error: loadError } = await supabase
        .from("alerts")
        .select("id, site_id, subject_id, type, severity, status, zone_id, message, resolved_at, created_at, alert_recipients(alert_id, profile_id, responded, responded_at)")
        .eq("subject_id", profileId)
        .eq("status", "open")
        .in("type", ["no_response", "no_heartbeat", "sos"]);
      if (!active) return;
      const rows = (data ?? []) as Array<Alert & { alert_recipients: AlertRecipient[] | null }>;
      setAlerts(rows.map(({ alert_recipients, ...alert }) => ({ ...alert, recipients: alert_recipients ?? [] })));
      setLoading(false);
      setError(loadError?.message ?? null);
    };

    void loadAlerts();
    const channel = supabase
      .channel(`my-subject-escalations:${profileId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `subject_id=eq.${profileId}` }, () => {
        void loadAlerts();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_recipients" }, () => {
        void loadAlerts();
      })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [profileId]);

  return { alerts, loading, error };
}
