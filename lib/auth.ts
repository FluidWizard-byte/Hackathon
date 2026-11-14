import "server-only";

import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "manager" | "supervisor" | "worker";

export type SessionProfile = {
  id: string;
  org_id: string;
  site_id: string;
  role: UserRole;
  active: boolean;
};

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, org_id, site_id, role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return null;

  const profile = data as SessionProfile;
  return profile.active ? profile : null;
}

export async function requireRole(...roles: UserRole[]): Promise<SessionProfile> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const profile = await getSessionProfile();
  if (!profile || !roles.includes(profile.role)) {
    throw new Response("Forbidden", { status: 403 });
  }

  return profile;
}
