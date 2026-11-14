"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/browser";

type DemoUser = {
  employeeId: string;
  fullName: string;
  role: "admin" | "supervisor" | "worker";
};

type LoginFormProps = {
  demoMode: boolean;
  demoUsers: DemoUser[];
  initialEmployeeId: string;
  initialOrganization: string;
};

function destinationForRole(role: DemoUser["role"] | "manager"): string {
  if (role === "worker") return "/helmet";
  if (role === "admin") return "/setup";
  return "/dashboard";
}

export function LoginForm({
  demoMode,
  demoUsers,
  initialEmployeeId,
  initialOrganization,
}: LoginFormProps) {
  const router = useRouter();
  const [organization, setOrganization] = useState(initialOrganization);
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(org: string, employee: string, password: string) {
    const normalizedOrg = org.trim().toLowerCase();
    const normalizedEmployee = employee.trim().toLowerCase();
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: `${normalizedEmployee}@${normalizedOrg}.safesite.local`,
      password,
    });

    if (signInError || !data.user) {
      setError("Unable to sign in. Check the organization, employee ID, and PIN.");
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError || !profile?.active) {
      await supabase.auth.signOut();
      setError("This account is inactive or unavailable.");
      return;
    }

    router.replace(destinationForRole(profile.role as DemoUser["role"] | "manager"));
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    await signIn(organization, employeeId, pin);
    setSubmitting(false);
  }

  async function handleDemoLogin(user: DemoUser) {
    setError(null);
    setSubmitting(true);
    setOrganization("demo");
    setEmployeeId(user.employeeId);
    await signIn("demo", user.employeeId, "123456");
    setSubmitting(false);
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-8 rounded-xl bg-white p-6 shadow-lg">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sign in to SafeSite</h1>
        <p className="mt-1 text-sm text-slate-600">Use your organization, employee ID, and PIN.</p>
      </div>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm font-semibold text-slate-800">
          Organization slug
          <input className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2" onChange={(event) => setOrganization(event.target.value)} required value={organization} />
        </label>
        <label className="block text-sm font-semibold text-slate-800">
          Employee ID
          <input className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2" onChange={(event) => setEmployeeId(event.target.value)} required value={employeeId} />
        </label>
        <label className="block text-sm font-semibold text-slate-800">
          PIN
          <input className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2" inputMode="numeric" minLength={6} onChange={(event) => setPin(event.target.value)} required type="password" value={pin} />
        </label>
        {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        <button className="w-full rounded-md bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-60" disabled={submitting} type="submit">
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {demoMode ? (
        <section className="border-t border-slate-200 pt-6">
          <h2 className="text-base font-bold text-slate-900">Demo users</h2>
          <div className="mt-3 grid gap-2">
            {demoUsers.map((user) => (
              <button className="rounded-md border border-slate-300 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-60" disabled={submitting} key={user.employeeId} onClick={() => handleDemoLogin(user)} type="button">
                <span className="font-semibold text-slate-900">{user.fullName}</span>
                <span className="ml-2 capitalize text-slate-600">{user.role}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
