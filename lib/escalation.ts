import { distance, nearestWorkers, type Worker } from "./geometry";

export type EscalationWorker = Worker & {
  isSimulated: boolean;
};

export type EscalationRecipient = {
  profileId: string;
  reason: "supervisor" | "nearby";
};

type EscalationSubject = Worker & {
  fullName: string;
};

/**
 * Routes an escalation to the assigned supervisor and nearby workers. Real workers
 * always fill the nearby slots first; simulation workers only backfill the remainder.
 */
export function selectRecipients(
  subject: EscalationWorker,
  workers: readonly EscalationWorker[],
  supervisorId: string | null,
  nearbyCount: number,
): EscalationRecipient[] {
  const realWorkers = workers.filter((worker) => !worker.isSimulated);
  const nearestRealWorkers = nearestWorkers(subject, realWorkers, nearbyCount);
  const simulatedWorkers = workers.filter((worker) => worker.isSimulated);
  const nearestSimulatedWorkers = nearestWorkers(
    subject,
    simulatedWorkers,
    Math.max(0, nearbyCount - nearestRealWorkers.length),
  );

  const recipients = new Map<string, EscalationRecipient["reason"]>();
  if (supervisorId) recipients.set(supervisorId, "supervisor");
  for (const worker of [...nearestRealWorkers, ...nearestSimulatedWorkers]) {
    if (!recipients.has(worker.id)) recipients.set(worker.id, "nearby");
  }

  return [...recipients].map(([profileId, reason]) => ({ profileId, reason }));
}

/** Formats a recipient-safe message without requiring the client to read another profile. */
export function buildEscalationMessage(
  subject: Pick<EscalationSubject, "fullName">,
  zoneName: string | null,
  distanceMeters: number,
): string {
  const roundedDistance = Math.max(0, Math.round(distanceMeters));
  return `${subject.fullName} needs help — ~${roundedDistance} m away, ${zoneName ?? "Unknown zone"}`;
}

export function recipientDistanceMeters(
  subject: Pick<EscalationSubject, "x" | "y">,
  recipient: Pick<EscalationWorker, "x" | "y"> | undefined,
  metersPerUnit: number,
): number {
  if (!recipient || !Number.isFinite(metersPerUnit) || metersPerUnit < 0) return 0;
  return distance(subject, recipient) * metersPerUnit;
}
