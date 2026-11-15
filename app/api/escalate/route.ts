import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/auth";
import { escalateWorker } from "@/lib/escalation-service";

const EscalateBody = z.object({ reason: z.enum(["no_response", "sos"]) }).strict();

export async function POST(request: Request) {
  try {
    const { reason } = EscalateBody.parse(await request.json());
    const profile = await requireRole("worker");
    const escalation = await escalateWorker({
      subjectId: profile.id,
      orgId: profile.org_id,
      siteId: profile.site_id,
      reason,
    });
    return NextResponse.json({ ok: true, alertId: escalation.alertId, message: escalation.message });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return NextResponse.json({ error: "reason must be no_response or sos" }, { status: 400 });
    console.error("Unable to create escalation", error);
    return NextResponse.json({ error: "Unable to create escalation" }, { status: 500 });
  }
}
