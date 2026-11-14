import { LoginForm } from "@/components/LoginForm";

const demoUsers = [
  { employeeId: "admin", fullName: "Demo Admin", role: "admin" as const },
  { employeeId: "supervisor-maint", fullName: "Morgan Lee", role: "supervisor" as const },
  { employeeId: "supervisor-prod", fullName: "Riley Chen", role: "supervisor" as const },
  { employeeId: "supervisor-warehouse", fullName: "Jordan Patel", role: "supervisor" as const },
  { employeeId: "worker-001", fullName: "Avery Brooks", role: "worker" as const },
  { employeeId: "worker-002", fullName: "Casey Rivera", role: "worker" as const },
  { employeeId: "worker-003", fullName: "Taylor Kim", role: "worker" as const },
  ...Array.from({ length: 8 }, (_, index) => ({ employeeId: `sim-a-${String(index + 1).padStart(2, "0")}`, fullName: `Sim Worker A${String(index + 1).padStart(2, "0")}`, role: "worker" as const })),
  ...Array.from({ length: 7 }, (_, index) => ({ employeeId: `sim-b-${String(index + 1).padStart(2, "0")}`, fullName: `Sim Worker B${String(index + 1).padStart(2, "0")}`, role: "worker" as const })),
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; emp?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="px-4 py-10">
      <LoginForm
        demoMode={process.env.DEMO_MODE === "true"}
        demoUsers={demoUsers}
        initialEmployeeId={params.emp ?? ""}
        initialOrganization={params.org ?? ""}
      />
    </main>
  );
}
