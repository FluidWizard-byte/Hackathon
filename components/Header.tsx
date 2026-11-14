import Link from "next/link";

import { getSessionProfile } from "@/lib/auth";

import { LogoutButton } from "./LogoutButton";

export async function Header() {
  const profile = await getSessionProfile();

  return (
    <header className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-4 py-3 text-slate-50">
      <Link className="text-lg font-bold" href="/">
        SafeSite
      </Link>
      {profile ? (
        <div className="flex items-center gap-3">
          <span className="text-sm capitalize text-slate-300">{profile.role}</span>
          <LogoutButton />
        </div>
      ) : (
        <Link className="text-sm font-semibold text-slate-200 hover:text-white" href="/login">
          Log in
        </Link>
      )}
    </header>
  );
}
