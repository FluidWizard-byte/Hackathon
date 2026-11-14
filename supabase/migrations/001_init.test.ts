import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("./001_init.sql", import.meta.url), "utf8");

describe("001_init migration", () => {
  it("enables RLS and publishes the required realtime tables", () => {
    expect(migration).toContain("alter table public.alerts enable row level security;");
    expect(migration).toContain("create function public.auth_org()");
    expect(migration).toContain("create function public.auth_role()");
    expect(migration).toContain("create function public.auth_site()");
    expect(migration).toContain("public.worker_positions,");
    expect(migration).toContain("public.alert_recipients,");
    expect(migration).toContain("public.loto_tickets,");
    expect(migration).toContain("public.equipment;");
  });
});
