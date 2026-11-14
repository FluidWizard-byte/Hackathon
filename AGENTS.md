# AGENTS.md — SafeSite (working name)

Hackathon MVP: an OSHA-focused worker safety platform. One web app, role-based views,
multi-site. Phones simulate wearable sensors. Full scope: `docs/SPEC.md` (read the
relevant section before starting a task).

## Stack (do not change)
- Next.js (App Router) + TypeScript (strict) + Tailwind CSS
- Supabase: Postgres, Auth, Realtime, Row Level Security
- OpenAI API: only in `lib/openai.ts` (LOTO report parsing)
- Vitest for unit tests
- Deploy: Vercel
- Do NOT add new dependencies without saying so in the task output and justifying it.

## Commands
- `npm run dev` — local dev server
- `npm run typecheck` / `npm run lint` / `npm test`
- `npm run db:reset` — apply `supabase/migrations/*` and reseed
- `npm run seed` — seed demo org, 2 sites, users, zones, equipment
- `npm run sim` — simulator + watchdog (fake workers, heartbeat timeouts)

Before finishing any task: `npm run typecheck && npm test` must pass.

## Folder map
```
app/login/            login (employee ID + PIN; demo buttons when DEMO_MODE)
app/helmet/           WORKER phone view (mobile-first)
app/helmet/scan/      QR zone-entry handler (?zone=<id>)
app/dashboard/        SUPERVISOR (own site) + MANAGER (all sites) live view
app/setup/            ADMIN: sites, zones, people (onboarding)
app/demo/             demo trigger panel (DEMO_MODE only)
app/api/**            ALL writes go through route handlers here
components/           shared UI (FloorPlan, AlertFeed, LotoBoard, ...)
lib/supabase/         browser + server + admin(service-role) clients
lib/auth.ts           getSessionProfile(), requireRole()
lib/geometry.ts       pointInPolygon, centroid, distance, nearestWorkers
lib/loto.ts           LOTO state machine + permission rules (pure)
lib/escalation.ts     no-response / SOS escalation logic (pure)
lib/alerts.ts         createAlert() + recipient fan-out
lib/realtime.ts       the ONLY place that subscribes to Supabase Realtime
lib/openai.ts         parseHazardReport()
supabase/migrations/  SQL schema + RLS policies
supabase/seed.ts      demo data
scripts/simulator.ts  fake movement + watchdog loop
docs/                 SPEC.md (source of truth)
```

## Roles (enum `user_role`)
`admin` | `manager` | `supervisor` | `worker`
- Only `admin` creates/edits/deactivates users and zone authorizations.
- `manager` sees all sites in the org; `supervisor` sees own site only;
  `worker` sees only the helmet view and their own data.
- After login, route by role: worker→`/helmet`, supervisor/manager→`/dashboard`,
  admin→`/setup`. Hide nav items a role cannot use AND enforce on the server.

## Hard rules
1. **Multi-tenancy:** every table has `org_id`; site-scoped tables also `site_id`.
   Every query filters by them. Never trust org/site IDs sent from the client —
   derive them from the session profile.
2. **Writes go through `app/api/**` route handlers** that call `requireRole()`.
   Client components only read (via supabase-js under RLS) and call our API.
3. **Service-role key is server-only** (`lib/supabase/admin.ts`). Never import it in
   a client component or expose it via `NEXT_PUBLIC_*`.
4. **Business rules live in pure functions** in `lib/` (geometry, loto, escalation)
   with unit tests. Route handlers stay thin.
5. **LOTO rule (OSHA 1910.147):** only the worker who applied a lock may release it.
   Enforced in `lib/loto.ts` and re-checked in the API.
6. **Alerts** are rows in `alerts` + `alert_recipients`. Never notify from UI code;
   UI reacts to realtime changes.
7. **Timers are env-configurable** (see SPEC §7). Never hard-code durations.
8. Floor-plan coordinates are normalized `0..1000` on both axes.
9. The helmet page must work on iOS Safari + Android Chrome over HTTPS; request
   DeviceMotion permission from a user tap.
10. If the OpenAI call fails or times out (5s), fall back to the manual LOTO form.
    Never block a safety flow on AI.

## Code style
- TypeScript strict, no `any`. Zod for all API input validation.
- Server Components by default; `"use client"` only where needed.
- Tailwind only, no CSS files except `globals.css`. Status colors:
  green `ok`, amber `warning`, red `alert/locked_out`.
- Small files; one component per file; named exports.
- Big, high-contrast touch targets on `/helmet` (gloved hands, outdoor light).

## How to work on a task
- Modify only the files the task names (plus their tests). Ask before touching others.
- Output code changes; skip long explanations and summaries.
- If the task is ambiguous, follow `docs/SPEC.md`; if SPEC is silent, choose the
  simplest option and leave a `// DECISION:` comment.
- New table/column → new migration file in `supabase/migrations/` + update
  `docs/SPEC.md §5` + update the seed.
- Don't refactor unrelated code. Don't rename existing exports.

## Out of scope (do not build)
Real BLE/UWB/RFID hardware, PPE image detection, SMS, CSV bulk import, compliance
report exports, self-signup, password reset flows, native mobile apps.
