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
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved";
  zone_id: string | null;
  message: string;
  created_at: string;
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
  lotoTickets: LotoTicket[];
  loading: boolean;
  error: string | null;
};

const emptyData: SiteRealtimeData = {
  workerPositions: [],
  equipment: [],
  alerts: [],
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
      const [positions, equipment, alerts, lotoTickets] = await Promise.all([
        supabase
          .from("worker_positions")
          .select("profile_id, site_id, x, y, zone_id, on_shift, last_heartbeat_at, status, profiles(full_name, role)")
          .eq("site_id", siteId),
        supabase.from("equipment").select("id, site_id, name, x, y, status").eq("site_id", siteId),
        supabase
          .from("alerts")
          .select("id, site_id, type, severity, status, zone_id, message, created_at")
          .eq("site_id", siteId),
        supabase
          .from("loto_tickets")
          .select("id, site_id, equipment_id, status, summary, created_at")
          .eq("site_id", siteId),
      ]);

      const firstError = positions.error ?? equipment.error ?? alerts.error ?? lotoTickets.error;
      if (!active) return;

      setData({
        workerPositions: (positions.data ?? []) as unknown as WorkerPosition[],
        equipment: (equipment.data ?? []) as unknown as Equipment[],
        alerts: (alerts.data ?? []) as unknown as Alert[],
        lotoTickets: (lotoTickets.data ?? []) as unknown as LotoTicket[],
        loading: false,
        error: firstError?.message ?? null,
      });
    };

    void loadInitialData();

    const channel = supabase
      .channel(`site-dashboard:${siteId}`)
      .on<WorkerPosition>("postgres_changes", { event: "*", schema: "public", table: "worker_positions", filter: `site_id=eq.${siteId}` }, (payload) => {
        if (active) setData((current) => ({ ...current, workerPositions: applyChange(current.workerPositions, payload, "profile_id") }));
      })
      .on<Equipment>("postgres_changes", { event: "*", schema: "public", table: "equipment", filter: `site_id=eq.${siteId}` }, (payload) => {
        if (active) setData((current) => ({ ...current, equipment: applyChange(current.equipment, payload, "id") }));
      })
      .on<Alert>("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `site_id=eq.${siteId}` }, (payload) => {
        if (active) setData((current) => ({ ...current, alerts: applyChange(current.alerts, payload, "id") }));
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
