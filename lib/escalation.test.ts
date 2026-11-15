import { describe, expect, it } from "vitest";

import {
  buildEscalationMessage,
  recipientDistanceMeters,
  selectRecipients,
  type EscalationWorker,
} from "./escalation";

const subject: EscalationWorker = {
  id: "subject",
  x: 0,
  y: 0,
  active: true,
  onShift: true,
  isSimulated: false,
};

describe("escalation", () => {
  it("includes the supervisor and prefers real nearby workers", () => {
    const workers: EscalationWorker[] = [
      { id: "sim-nearest", x: 1, y: 0, active: true, onShift: true, isSimulated: true },
      { id: "real-near", x: 3, y: 0, active: true, onShift: true, isSimulated: false },
      { id: "real-far", x: 7, y: 0, active: true, onShift: true, isSimulated: false },
      { id: "off-shift", x: 0.5, y: 0, active: true, onShift: false, isSimulated: false },
    ];

    expect(selectRecipients(subject, workers, "supervisor", 2)).toEqual([
      { profileId: "supervisor", reason: "supervisor" },
      { profileId: "real-near", reason: "nearby" },
      { profileId: "real-far", reason: "nearby" },
    ]);
  });

  it("uses simulated workers only to fill unfilled nearby slots", () => {
    const workers: EscalationWorker[] = [
      { id: "real", x: 4, y: 0, active: true, onShift: true, isSimulated: false },
      { id: "sim-near", x: 1, y: 0, active: true, onShift: true, isSimulated: true },
      { id: "sim-far", x: 8, y: 0, active: true, onShift: true, isSimulated: true },
    ];

    expect(selectRecipients(subject, workers, null, 3)).toEqual([
      { profileId: "real", reason: "nearby" },
      { profileId: "sim-near", reason: "nearby" },
      { profileId: "sim-far", reason: "nearby" },
    ]);
  });

  it("deduplicates a nearby supervisor and builds a plain-text distance message", () => {
    const supervisor: EscalationWorker = { id: "supervisor", x: 2, y: 0, active: true, onShift: true, isSimulated: false };

    expect(selectRecipients(subject, [supervisor], "supervisor", 1)).toEqual([
      { profileId: "supervisor", reason: "supervisor" },
    ]);
    expect(buildEscalationMessage({ fullName: "Avery Brooks" }, "Assembly", recipientDistanceMeters(subject, supervisor, 7.5))).toBe(
      "Avery Brooks needs help — ~15 m away, Assembly",
    );
  });
});
