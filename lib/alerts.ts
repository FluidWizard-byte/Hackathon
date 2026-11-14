import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AlertRecipientReason = "subject" | "supervisor" | "department" | "nearby";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertType = "unauthorized_zone" | "no_response" | "no_heartbeat" | "sos" | "loto";

type CreateAlertInput = {
  type: AlertType;
  severity: AlertSeverity;
  siteId: string;
  subjectId?: string;
  zoneId?: string;
  equipmentId?: string;
  ticketId?: string;
  message: string;
  recipients: { profileId: string; reason: AlertRecipientReason }[];
};

/** Creates an alert and its distinct recipients using the server-only admin client. */
export async function createAlert({ recipients, siteId, ...alert }: CreateAlertInput) {
  const admin = createAdminClient();
  const { data: site, error: siteError } = await admin.from("sites").select("org_id").eq("id", siteId).single();
  if (siteError || !site) throw siteError ?? new Error("Alert site not found");
  const { data: createdAlert, error: alertError } = await admin
    .from("alerts")
    .insert({ org_id: site.org_id, site_id: siteId, ...alert })
    .select("id, org_id, site_id, type, severity, subject_id, zone_id, equipment_id, ticket_id, message, status, created_at")
    .single();

  if (alertError) {
    console.error("Failed to create alert", alertError);
    throw alertError;
  }

  const uniqueRecipients = new Map<string, AlertRecipientReason>();
  for (const recipient of recipients) {
    if (!uniqueRecipients.has(recipient.profileId)) uniqueRecipients.set(recipient.profileId, recipient.reason);
  }

  if (uniqueRecipients.size > 0) {
    const { error: recipientError } = await admin.from("alert_recipients").insert(
      [...uniqueRecipients].map(([profile_id, reason]) => ({ alert_id: createdAlert.id, profile_id, reason })),
    );
    if (recipientError) {
      console.error("Failed to create alert recipients", recipientError);
      throw recipientError;
    }
  }

  return createdAlert;
}
