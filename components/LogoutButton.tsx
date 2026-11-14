"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      className="rounded-md border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700"
      onClick={handleLogout}
      type="button"
    >
      Log out
    </button>
  );
}
