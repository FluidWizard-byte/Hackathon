"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AlertTakeover } from "@/components/AlertTakeover";
import { useMyAlerts } from "@/lib/realtime";
import { createClient } from "@/lib/supabase/browser";

const HEARTBEAT_INTERVAL_MS = 5_000;
const MOTION_WINDOW_MS = 5_000;
const MOTION_VARIANCE_THRESHOLD = 0.25;
const SOS_HOLD_MS = 2_000;

type MotionSample = { magnitude: number; timestamp: number };
type DeviceMotionConstructor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> };

function isMoving(samples: MotionSample[]): boolean {
  if (samples.length < 2) return false;
  const mean = samples.reduce((sum, sample) => sum + sample.magnitude, 0) / samples.length;
  const variance = samples.reduce((sum, sample) => sum + (sample.magnitude - mean) ** 2, 0) / samples.length;
  return variance > MOTION_VARIANCE_THRESHOLD;
}

export default function HelmetPage() {
  const samplesRef = useRef<MotionSample[]>([]);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOnShift, setIsOnShift] = useState(false);
  const [status, setStatus] = useState("Ready to start your shift");
  const [isHoldingSos, setIsHoldingSos] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [unauthorizedZoneName, setUnauthorizedZoneName] = useState<string | null>(null);
  const { alerts } = useMyAlerts(profileId ?? "");
  const unauthorizedAlert = alerts.find((alert) => alert.type === "unauthorized_zone" && alert.status === "open") ?? null;

  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => setProfileId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!unauthorizedAlert?.zone_id) {
      setUnauthorizedZoneName(null);
      return;
    }
    let active = true;
    void createClient().from("zones").select("name").eq("id", unauthorizedAlert.zone_id).maybeSingle().then(({ data }) => {
      if (active) setUnauthorizedZoneName(data?.name ?? null);
    });
    return () => { active = false; };
  }, [unauthorizedAlert?.zone_id]);

  useEffect(() => {
    const recordMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity;
      if (!acceleration || acceleration.x === null || acceleration.y === null || acceleration.z === null) return;
      const timestamp = Date.now();
      const magnitude = Math.sqrt(acceleration.x ** 2 + acceleration.y ** 2 + acceleration.z ** 2);
      samplesRef.current = [...samplesRef.current.filter((sample) => timestamp - sample.timestamp <= MOTION_WINDOW_MS), { magnitude, timestamp }];
    };
    window.addEventListener("devicemotion", recordMotion);
    return () => window.removeEventListener("devicemotion", recordMotion);
  }, []);

  const sendHeartbeat = useCallback(async () => {
    const now = Date.now();
    const currentSamples = samplesRef.current.filter((sample) => now - sample.timestamp <= MOTION_WINDOW_MS);
    samplesRef.current = currentSamples;
    try {
      const response = await fetch("/api/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moving: isMoving(currentSamples) }) });
      setStatus(response.ok ? "Shift active — connected" : "Unable to send heartbeat");
    } catch {
      setStatus("Unable to send heartbeat");
    }
  }, []);

  const startShift = async () => {
    if (heartbeatTimerRef.current) return;
    const motionEvent = DeviceMotionEvent as DeviceMotionConstructor;
    if (motionEvent.requestPermission) {
      try {
        if (await motionEvent.requestPermission() !== "granted") {
          setStatus("Motion permission is needed to start your shift");
          return;
        }
      } catch {
        setStatus("Motion permission is needed to start your shift");
        return;
      }
    }
    setIsOnShift(true);
    setStatus("Starting shift…");
    void sendHeartbeat();
    heartbeatTimerRef.current = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  };

  const sendSos = async () => {
    setIsHoldingSos(false);
    setStatus("SOS sent — help has been requested");
    try {
      await fetch("/api/escalate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "sos" }) });
    } catch {
      setStatus("Unable to send SOS — try again");
    }
  };

  const cancelSosHold = () => {
    if (sosTimerRef.current) clearTimeout(sosTimerRef.current);
    sosTimerRef.current = null;
    setIsHoldingSos(false);
  };
  const startSosHold = () => {
    if (sosTimerRef.current) return;
    setIsHoldingSos(true);
    sosTimerRef.current = setTimeout(() => { sosTimerRef.current = null; void sendSos(); }, SOS_HOLD_MS);
  };

  useEffect(() => () => {
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    if (sosTimerRef.current) clearTimeout(sosTimerRef.current);
  }, []);

  const acknowledgeUnauthorizedAlert = async () => {
    if (!unauthorizedAlert) return;
    try {
      const response = await fetch(`/api/alerts/${unauthorizedAlert.id}/ack`, { method: "POST" });
      if (!response.ok) setStatus("Unable to acknowledge alert");
    } catch {
      setStatus("Unable to acknowledge alert");
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg flex-col gap-5 bg-slate-950 px-5 py-6 text-white">
      <AlertTakeover isOpen={unauthorizedAlert !== null} severity="red" title={`You are not authorized for ${unauthorizedZoneName ?? "this zone"} — leave now`} message="Leave the area immediately and notify your supervisor." primaryLabel="Acknowledge" onPrimary={() => void acknowledgeUnauthorizedAlert()} />
      <div><p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-300">SafeSite</p><h1 className="mt-1 text-4xl font-black tracking-tight">Worker safety</h1><p className="mt-3 text-lg text-slate-200" role="status">{status}</p></div>
      {!isOnShift ? <button type="button" onClick={() => void startShift()} className="min-h-28 rounded-2xl bg-green-500 px-6 py-5 text-3xl font-black text-slate-950 shadow-lg shadow-green-500/20 active:bg-green-400">Start shift</button> : <div className="rounded-2xl border-2 border-green-400 bg-green-950/50 px-5 py-6 text-center text-2xl font-black text-green-200">Shift active</div>}
      <button type="button" onPointerDown={startSosHold} onPointerUp={cancelSosHold} onPointerLeave={cancelSosHold} onPointerCancel={cancelSosHold} className="min-h-36 rounded-2xl border-4 border-red-200 bg-red-600 px-6 py-5 text-4xl font-black text-white shadow-lg shadow-red-950/50 active:bg-red-500" aria-label="Hold for two seconds to send an SOS">{isHoldingSos ? "Keep holding SOS…" : "Hold SOS (2 sec)"}</button>
      <button type="button" disabled className="min-h-24 rounded-2xl border-2 border-amber-300 bg-amber-400 px-6 py-5 text-2xl font-black text-slate-950 opacity-70">Report Hazard<span className="mt-1 block text-sm font-bold">Coming soon</span></button>
    </main>
  );
}
