"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AlertTakeover } from "@/components/AlertTakeover";
import { useMyAlerts, useMySubjectEscalations } from "@/lib/realtime";
import { createClient } from "@/lib/supabase/browser";

const HEARTBEAT_INTERVAL_MS = 5_000;
const MOTION_WINDOW_MS = 5_000;
const MOTION_VARIANCE_THRESHOLD = 0.25;
const SOS_HOLD_MS = 2_000;

type MotionSample = { magnitude: number; timestamp: number };
type DeviceMotionConstructor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> };
type EscalationReason = "no_response" | "sos";

export type HelmetTimerConfig = {
  noMotionSeconds: number;
  confirmSeconds: number;
};

function isMoving(samples: MotionSample[]): boolean {
  if (samples.length < 2) return false;
  const mean = samples.reduce((sum, sample) => sum + sample.magnitude, 0) / samples.length;
  const variance = samples.reduce((sum, sample) => sum + (sample.magnitude - mean) ** 2, 0) / samples.length;
  return variance > MOTION_VARIANCE_THRESHOLD;
}

export function HelmetClient({ timerConfig }: { timerConfig: HelmetTimerConfig }) {
  const samplesRef = useRef<MotionSample[]>([]);
  const lastMotionAtRef = useRef<number>(0);
  const heartbeatTimerRef = useRef<number | null>(null);
  const sosTimerRef = useRef<number | null>(null);
  const noResponseSentRef = useRef(false);
  const [isOnShift, setIsOnShift] = useState(false);
  const [status, setStatus] = useState("Ready to start your shift");
  const [isHoldingSos, setIsHoldingSos] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [unauthorizedZoneName, setUnauthorizedZoneName] = useState<string | null>(null);
  const [checkinDeadline, setCheckinDeadline] = useState<number | null>(null);
  const [confirmSecondsRemaining, setConfirmSecondsRemaining] = useState(timerConfig.confirmSeconds);
  const { alerts } = useMyAlerts(profileId ?? "");
  const { alerts: subjectEscalations } = useMySubjectEscalations(profileId ?? "");
  const unauthorizedAlert = alerts.find((alert) => alert.type === "unauthorized_zone" && alert.status === "open") ?? null;
  const nearbyEmergencyAlert = alerts.find(
    (alert) =>
      (alert.type === "no_response" || alert.type === "no_heartbeat" || alert.type === "sos") &&
      alert.status === "open" &&
      !alert.responded,
  ) ?? null;
  const respondingCount = new Set(
    subjectEscalations.flatMap((alert) => alert.recipients.filter((recipient) => recipient.responded).map((recipient) => recipient.profile_id)),
  ).size;

  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => setProfileId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!unauthorizedAlert?.zone_id) {
      setUnauthorizedZoneName(null);
      return;
    }
    let active = true;
    void createClient()
      .from("zones")
      .select("name")
      .eq("id", unauthorizedAlert.zone_id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setUnauthorizedZoneName(data?.name ?? null);
      });
    return () => {
      active = false;
    };
  }, [unauthorizedAlert?.zone_id]);

  useEffect(() => {
    const recordMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity;
      if (!acceleration || acceleration.x === null || acceleration.y === null || acceleration.z === null) return;
      const timestamp = Date.now();
      const magnitude = Math.sqrt(acceleration.x ** 2 + acceleration.y ** 2 + acceleration.z ** 2);
      samplesRef.current = [
        ...samplesRef.current.filter((sample) => timestamp - sample.timestamp <= MOTION_WINDOW_MS),
        { magnitude, timestamp },
      ];
    };
    window.addEventListener("devicemotion", recordMotion);
    return () => window.removeEventListener("devicemotion", recordMotion);
  }, []);

  const sendHeartbeat = useCallback(async () => {
    const now = Date.now();
    const currentSamples = samplesRef.current.filter((sample) => now - sample.timestamp <= MOTION_WINDOW_MS);
    samplesRef.current = currentSamples;
    const moving = isMoving(currentSamples);
    if (moving) lastMotionAtRef.current = now;
    try {
      const response = await fetch("/api/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moving }),
      });
      setStatus(response.ok ? "Shift active — connected" : "Unable to send heartbeat");
    } catch {
      setStatus("Unable to send heartbeat");
    }
  }, []);

  const escalate = useCallback(async (reason: EscalationReason): Promise<boolean> => {
    try {
      const response = await fetch("/api/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("Escalation request failed");
      setStatus(reason === "sos" ? "SOS sent — help has been requested" : "No response recorded — help has been requested");
      return true;
    } catch {
      setStatus(reason === "sos" ? "Unable to send SOS — try again" : "Unable to request help — try again");
      return false;
    }
  }, []);

  const checkIn = async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/checkin/ok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Check-in request failed");
      lastMotionAtRef.current = Date.now();
      noResponseSentRef.current = false;
      setCheckinDeadline(null);
      setStatus("Checked in — shift active");
      return true;
    } catch {
      setStatus("Unable to check in — try again");
      return false;
    }
  };

  const startShift = async () => {
    if (heartbeatTimerRef.current) return;
    if (!await checkIn()) return;
    const motionEvent = typeof DeviceMotionEvent === "undefined" ? undefined : DeviceMotionEvent as DeviceMotionConstructor;
    if (motionEvent?.requestPermission) {
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
    lastMotionAtRef.current = Date.now();
    noResponseSentRef.current = false;
    setIsOnShift(true);
    setStatus("Starting shift…");
    void sendHeartbeat();
    heartbeatTimerRef.current = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  };

  useEffect(() => {
    if (!isOnShift || checkinDeadline !== null) return;
    const checkForNoMotion = () => {
      const noMotionForMs = Date.now() - lastMotionAtRef.current;
      if (!noResponseSentRef.current && noMotionForMs >= timerConfig.noMotionSeconds * 1_000) {
        setConfirmSecondsRemaining(timerConfig.confirmSeconds);
        setCheckinDeadline(Date.now() + timerConfig.confirmSeconds * 1_000);
      }
    };
    checkForNoMotion();
    const timer = window.setInterval(checkForNoMotion, 1_000);
    return () => window.clearInterval(timer);
  }, [checkinDeadline, isOnShift, timerConfig.confirmSeconds, timerConfig.noMotionSeconds]);

  useEffect(() => {
    if (checkinDeadline === null) return;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((checkinDeadline - Date.now()) / 1_000));
      setConfirmSecondsRemaining(remaining);
      if (remaining !== 0) return;

      setCheckinDeadline(null);
      if (noResponseSentRef.current) return;
      noResponseSentRef.current = true;
      void escalate("no_response").then((sent) => {
        if (!sent) noResponseSentRef.current = false;
      });
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [checkinDeadline, escalate]);

  const sendSos = async () => {
    setIsHoldingSos(false);
    await escalate("sos");
  };

  const cancelSosHold = () => {
    if (sosTimerRef.current) window.clearTimeout(sosTimerRef.current);
    sosTimerRef.current = null;
    setIsHoldingSos(false);
  };

  const startSosHold = () => {
    if (sosTimerRef.current) return;
    setIsHoldingSos(true);
    sosTimerRef.current = window.setTimeout(() => {
      sosTimerRef.current = null;
      void sendSos();
    }, SOS_HOLD_MS);
  };

  useEffect(() => () => {
    if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    if (sosTimerRef.current) window.clearTimeout(sosTimerRef.current);
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

  const respondToEmergency = async () => {
    if (!nearbyEmergencyAlert) return;
    try {
      const response = await fetch(`/api/alerts/${nearbyEmergencyAlert.id}/respond`, { method: "POST" });
      if (!response.ok) throw new Error("Response request failed");
      setStatus("Responding — help is on the way");
    } catch {
      setStatus("Unable to mark your response — try again");
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg flex-col gap-5 bg-slate-950 px-5 py-6 text-white">
      {subjectEscalations.length > 0 ? (
        <AlertTakeover isOpen severity="red" title={`Help has been alerted — ${respondingCount} responding`} message="Stay where you are if it is safe to do so." primaryLabel="I’m OK — cancel alert" onPrimary={() => void checkIn()} />
      ) : nearbyEmergencyAlert ? (
        <AlertTakeover isOpen severity="red" title={nearbyEmergencyAlert.message} message="Respond immediately if you can safely assist." primaryLabel="Responding" onPrimary={() => void respondToEmergency()} />
      ) : checkinDeadline !== null ? (
        <AlertTakeover isOpen severity="amber" title="Are you OK?" message={`Confirm within ${confirmSecondsRemaining} seconds or help will be requested.`} primaryLabel="I'm OK" onPrimary={() => void checkIn()} />
      ) : unauthorizedAlert ? (
        <AlertTakeover isOpen severity="red" title={`You are not authorized for ${unauthorizedZoneName ?? "this zone"} — leave now`} message="Leave the area immediately and notify your supervisor." primaryLabel="Acknowledge" onPrimary={() => void acknowledgeUnauthorizedAlert()} />
      ) : null}
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-300">SafeSite</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">Worker safety</h1>
        <p className="mt-3 text-lg text-slate-200" role="status">{status}</p>
      </div>
      {!isOnShift ? (
        <button type="button" onClick={() => void startShift()} className="min-h-28 rounded-2xl bg-green-500 px-6 py-5 text-3xl font-black text-slate-950 shadow-lg shadow-green-500/20 active:bg-green-400">Start shift</button>
      ) : (
        <div className="rounded-2xl border-2 border-green-400 bg-green-950/50 px-5 py-6 text-center text-2xl font-black text-green-200">Shift active</div>
      )}
      <button type="button" onPointerDown={startSosHold} onPointerUp={cancelSosHold} onPointerLeave={cancelSosHold} onPointerCancel={cancelSosHold} className="min-h-36 rounded-2xl border-4 border-red-200 bg-red-600 px-6 py-5 text-4xl font-black text-white shadow-lg shadow-red-950/50 active:bg-red-500" aria-label="Hold for two seconds to send an SOS">{isHoldingSos ? "Keep holding SOS…" : "Hold SOS (2 sec)"}</button>
      <button type="button" disabled className="min-h-24 rounded-2xl border-2 border-amber-300 bg-amber-400 px-6 py-5 text-2xl font-black text-slate-950 opacity-70">Report Hazard<span className="mt-1 block text-sm font-bold">Coming soon</span></button>
    </main>
  );
}
