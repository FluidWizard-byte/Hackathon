import { HelmetClient, type HelmetTimerConfig } from "@/app/helmet/HelmetClient";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

function requiredPositiveSeconds(name: "NO_MOTION_SECONDS" | "CONFIRM_SECONDS"): number {
  const seconds = Number(process.env[name]);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error(`${name} must be set to a positive integer`);
  }
  return seconds;
}

export default async function HelmetPage() {
  await requireRole("worker");
  const timerConfig: HelmetTimerConfig = {
    noMotionSeconds: requiredPositiveSeconds("NO_MOTION_SECONDS"),
    confirmSeconds: requiredPositiveSeconds("CONFIRM_SECONDS"),
  };

  return <HelmetClient timerConfig={timerConfig} />;
}
