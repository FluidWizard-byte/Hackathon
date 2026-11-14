# SafeSite — MVP Specification

Source of truth for scope. If code and this doc disagree, this doc wins (or update it
in the same change).

---

## 1. Product summary

A worker-safety platform for OSHA-regulated sites (manufacturing, warehouses). One web
app; users log in and see different screens based on role. A company runs multiple
sites; each site has its own floor plan, zones, equipment, and people.

**MVP goal:** a reliable live demo over one weekend. Phones stand in for wearable
"helmet" sensors; printed QR codes stand in for RFID/BLE zone gates; a simulator
populates the floor with fake workers and equipment.

**Pitch line:** "Phones and QR codes simulate the BLE/UWB tags used in production."

---

## 2. Roles & permissions

| Capability | Admin | Manager | Supervisor | Worker |
|---|---|---|---|---|
| Create/edit/deactivate users | ✅ | — | — | — |
| Assign roles, sites, zone access | ✅ | — | — | — |
| Create sites, upload floor plan, draw zones, add equipment | ✅ | — | — | — |
| View dashboard | all sites | all sites | own site | — |
| Acknowledge / resolve alerts | ✅ | ✅ | own site | — |
| Receive routed LOTO tickets | — | — | ✅ | — |
| Verify a lockout | — | ✅ | ✅ | — |
| Report hazard / create LOTO ticket | ✅ | ✅ | ✅ | ✅ |
| Apply lock | — | — | ✅ | ✅ |
| Release lock | only the user who applied it | | | |
| Helmet view (heartbeat, SOS, zone scan) | — | — | — | ✅ |
| Respond to nearby man-down alert | — | — | ✅ | ✅ |

Demo shortcut: one seeded account may hold `admin` and act as the manager in the demo.

---

## 3. Features

### F0 — Auth, onboarding & multi-site (foundation)

**Login**
- Workers log in with **employee ID + PIN** (no email needed).
- Implementation: Supabase Auth email/password, where email is synthetic
  `{employee_id}@{org_slug}.safesite.local` and password is the PIN (min 6 digits).
  The login form only shows *Organization*, *Employee ID*, *PIN*.
- When `DEMO_MODE=true`, `/login` also shows one-tap buttons per seeded user.
- After login, route by role (see AGENTS.md).

**Admin onboarding — `/setup/people`**
1. Admin clicks **Add User** → form: full name, employee ID, role, site, department,
   supervisor (select, filtered to supervisors at that site), authorized zones
   (checkboxes for that site's zones).
2. `POST /api/admin/users` (admin only) creates the auth user via service-role client,
   inserts `profiles` + `zone_authorizations`, generates a random 6-digit PIN.
3. Response screen shows the **PIN once** and a **login QR code** encoding
   `/login?org=<slug>&emp=<employee_id>` (the PIN is never in the QR).
4. People list: name, employee ID, role, site, zones, status; actions: Edit
   (role/zones/supervisor), Reset PIN, Deactivate.
- Deactivated users cannot log in and disappear from the live map.

**Sites & zones — `/setup/sites`**
- Create a site (name, floor plan image upload to Supabase Storage).
- Zone editor: click points on the floor plan to draw a polygon, name it, set risk
  level `low | medium | high`. Edit/delete zones.
- Equipment: click to place, set name + department.
- For each zone, a **printable QR** encoding `/helmet/scan?zone=<zone_id>`.

**Site switcher** in the header for managers/admins; supervisors are locked to their site.

**Acceptance:** admin creates a new worker with access to Zones A+B; that worker logs
in on a phone via QR + PIN and appears on the dashboard map within 3 seconds.

---

### F1 — Smart Lockout/Tagout (LOTO)

**Report (worker phone or any role)**
1. Tap **Report Hazard** → choose equipment (list for current site) → free-text
   description (e.g., "guard on conveyor 3 is cracked, belt exposed").
2. `POST /api/loto/parse` → `lib/openai.ts#parseHazardReport()` returns structured JSON
   (Structured Outputs / JSON schema):
   `{ equipment_id | null, hazard_type, severity: "low"|"medium"|"high"|"critical",
      department, summary }`.
   The UI shows a pre-filled confirmation form; the user can edit, then submit.
   On AI failure/timeout (5s) show the same form empty — never block.
3. `POST /api/loto/tickets` creates the ticket (status `reported`) and a `loto` alert.

**Routing** (`lib/alerts.ts`): recipients =
- the reporter's `supervisor_id`, and
- all supervisors at the site whose `department` = the equipment's department.
Deduplicate. Recipients see it in their alert feed + toast.

**State machine** (`lib/loto.ts`, pure + unit tested):
```
reported ──apply_lock──▶ locked_out ──verify──▶ verified ──release──▶ released
```
| Action | Allowed roles | Extra rule |
|---|---|---|
| apply_lock | worker, supervisor | sets `locked_by` = actor; equipment.status = `locked_out` |
| verify | supervisor, manager | actor ≠ locked_by |
| release | anyone | **actor must equal `locked_by`** (OSHA 1910.147); equipment.status = `operational` |

Any invalid transition → 403 with a clear message ("Only the person who applied this
lock can remove it").

Every action writes a `loto_events` row (audit trail with actor + timestamp).

**UI:** LOTO board on dashboard (columns by status); ticket detail with timeline; locked
equipment shows red with a lock icon on the floor plan.

**Acceptance:** ticket created from text in <5s with fields filled; supervisor's phone
gets a toast; a different worker's release attempt is refused; original locker's release
succeeds; all steps visible in the timeline.

---

### F2 — Zone authorization alerts

1. Worker scans a zone QR with the phone camera → opens `/helmet/scan?zone=<id>`
   (already logged in) → `POST /api/zones/enter`.
2. Server: set worker position to zone centroid + small random jitter; set
   `worker_positions.zone_id`; write `zone_events` row.
3. `isAuthorized(profile, zone)` = row exists in `zone_authorizations`.
4. **If not authorized:** create `unauthorized_zone` alert (severity = zone risk level),
   recipients = the worker (subject) + their supervisor.
   - Worker phone: full-screen red takeover, vibration (`navigator.vibrate`),
     "You are not authorized for ZONE NAME — leave now", button **Acknowledge**.
   - Dashboard: zone polygon pulses red; alert appears in feed.
5. Simulator workers also trigger this via `pointInPolygon` when their path enters a
   zone they're not authorized for.

**Acceptance:** unauthorized scan → phone takeover + dashboard alert in <3s; authorized
scan → only position update, no alert.

---

### F3 — No-response / man-down alert

**On the phone (`/helmet`)**
- On "Start shift" tap: request DeviceMotion permission (iOS), start sending
  `POST /api/heartbeat` every 5s with `{ moving: boolean }`. `moving` = accelerometer
  magnitude variance above a threshold in the last 5s.
- If no movement for `NO_MOTION_SECONDS` (demo: 20) → full-screen **"Are you OK?"**
  with a `CONFIRM_SECONDS` (demo: 10) countdown and a big **I'm OK** button.
  - Tap → `POST /api/checkin/ok`, logged, nothing else.
  - Timeout → `POST /api/escalate` with reason `no_response`.
- **SOS button** (always visible, hold 2s to avoid accidental taps) →
  `POST /api/escalate` with reason `sos` immediately.

**Server watchdog** (in `scripts/simulator.ts` loop, every 5s, also callable at
`POST /api/watchdog`): if `last_heartbeat_at` older than `HEARTBEAT_TIMEOUT_SECONDS`
(demo: 30) for an on-shift worker → escalate with reason `no_heartbeat`.
(Covers a dead or dropped phone.)

**Escalation** (`lib/escalation.ts`, pure + tested):
- Create alert type `no_response` or `sos` (severity `critical`).
- Recipients: subject's supervisor + `NEARBY_COUNT` (demo: 3) nearest **active, on-shift**
  workers at the same site by Euclidean distance on the floor plan, excluding the subject.
- Nearby recipients' phones: takeover "NAME needs help — ~X m away, ZONE" with
  **Responding** button → `POST /api/alerts/:id/respond`.
- Dashboard: subject dot flashes red; responders shown with a line to the subject;
  alert shows "2 responding".
- Supervisor/manager can **Resolve** the alert.

Distance display: convert normalized units with `site.meters_per_unit` (seeded).

**Acceptance:** phone left still → prompt at 20s → escalation at 30s → nearest phones
alerted → "Responding" visible on dashboard.

---

### F4 — Live dashboard (`/dashboard`)

Layout (desktop, projector-friendly, dark theme):
- **Center: FloorPlan** — floor plan image, zone polygons (colored by risk, red pulse on
  violation), worker dots (initials, color by status), equipment icons (red + lock when
  locked out). Hover/click dot → name, role, zone, last heartbeat.
- **Right: AlertFeed** — newest first, type icon, severity color, subject, zone, age;
  Acknowledge / Resolve buttons by role.
- **Bottom: LotoBoard** — 4 status columns with ticket cards.
- **Top bar:** site switcher (manager/admin), headcount per zone, open-alert count,
  "Live" indicator.
- All panels update via `lib/realtime.ts` subscriptions (no polling).

**Acceptance:** with simulator running, ≥15 dots move smoothly; any alert or ticket change
appears on every permitted dashboard in <3s.

---

### F5 — Simulator & demo mode

**`scripts/simulator.ts`** (`npm run sim`, uses service-role key):
- Moves seeded "sim" workers along random waypoints every 1–2s; occasionally moves a
  forklift equipment icon.
- Sends heartbeats for sim workers so they never trigger the watchdog.
- Runs the watchdog every 5s.

**`/demo` panel** (`DEMO_MODE=true`, admin only): buttons that call `/api/demo/*`:
- Trigger unauthorized entry (picks a sim worker)
- Trigger man-down for a chosen worker
- Create sample LOTO ticket
- Reset demo state (clear alerts/tickets, reset positions, unlock equipment)

These are the fallbacks if a phone or QR scan fails on stage.

---

## 4. Out of scope
Real hardware (BLE/UWB/RFID), PPE image detection, SMS/email notifications, CSV bulk
import, compliance exports, self-signup, password reset by email, native apps,
historical analytics. (All are roadmap items for the pitch.)

---

## 5. Data model

All tables: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`
unless noted.

```
organizations      name, slug (unique)
sites              org_id, name, floorplan_url, meters_per_unit numeric default 0.05
zones              org_id, site_id, name, polygon jsonb  -- [[x,y],...] in 0..1000
                   risk_level enum(low,medium,high)
profiles           id = auth.users.id (pk), org_id, site_id, employee_id,
                   full_name, role user_role, department text,
                   supervisor_id → profiles.id null, active bool default true,
                   is_simulated bool default false
                   unique(org_id, employee_id)
zone_authorizations profile_id, zone_id   (pk both)
equipment          org_id, site_id, name, department, x, y,
                   status enum(operational,locked_out) default operational
worker_positions   profile_id pk, org_id, site_id, x, y, zone_id null,
                   on_shift bool, last_heartbeat_at, last_motion_at,
                   status enum(ok,check,alert) default ok, updated_at
zone_events        org_id, site_id, profile_id, zone_id, authorized bool
loto_tickets       org_id, site_id, equipment_id, reported_by, description,
                   hazard_type, severity enum(low,medium,high,critical),
                   department, summary,
                   status enum(reported,locked_out,verified,released),
                   locked_by null, verified_by null, released_by null,
                   locked_at, verified_at, released_at
loto_events        ticket_id, actor_id, action text, note text null
alerts             org_id, site_id,
                   type enum(unauthorized_zone,no_response,no_heartbeat,sos,loto),
                   severity enum(low,medium,high,critical),
                   subject_id → profiles null, zone_id null, equipment_id null,
                   ticket_id null, message,
                   status enum(open,acknowledged,resolved) default open,
                   acknowledged_by null, resolved_by null, resolved_at null
alert_recipients   alert_id, profile_id, reason enum(subject,supervisor,department,nearby),
                   responded bool default false, responded_at null   (pk alert_id+profile_id)
```

**Realtime publication:** `worker_positions`, `alerts`, `alert_recipients`,
`loto_tickets`, `equipment`.

**RLS (read scoping):** helper SQL functions `auth_org()`, `auth_role()`, `auth_site()`
reading from `profiles` for `auth.uid()`.
- admin/manager: rows where `org_id = auth_org()`
- supervisor: rows where `site_id = auth_site()`
- worker: own `profiles` row; own `worker_positions`; `alert_recipients` where
  `profile_id = auth.uid()` and their alerts; zones + equipment of own site;
  tickets they reported or locked.
- **No client-side insert/update policies** — all writes through API routes using the
  service-role client after `requireRole()` checks.

---

## 6. API routes (all validate input with Zod, derive org/site from session)

```
POST /api/admin/users                 admin   create user → returns PIN + login URL
PATCH /api/admin/users/:id            admin   edit role/site/zones/supervisor/active
POST /api/admin/users/:id/reset-pin   admin
POST /api/admin/sites | zones | equipment (+ PATCH/DELETE)   admin
POST /api/heartbeat                   worker  { moving }
POST /api/zones/enter                 worker  { zone_id }
POST /api/checkin/ok                  worker
POST /api/escalate                    worker  { reason: no_response | sos }
POST /api/alerts/:id/respond          worker/supervisor (must be recipient)
POST /api/alerts/:id/ack | /resolve   supervisor+ (scope-checked)
POST /api/loto/parse                  any     { text, site_id } → parsed fields
POST /api/loto/tickets                any     create
POST /api/loto/tickets/:id/:action    apply_lock | verify | release (rules in lib/loto.ts)
POST /api/watchdog                    service/admin
POST /api/demo/:scenario              admin + DEMO_MODE
```

---

## 7. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only
OPENAI_API_KEY=                   # server only
OPENAI_MODEL=                     # small, cheap model with structured outputs
DEMO_MODE=true
NO_MOTION_SECONDS=20
CONFIRM_SECONDS=10
HEARTBEAT_TIMEOUT_SECONDS=30
NEARBY_COUNT=3
```

---

## 8. Seed data (`npm run seed`)

- Org: "Demo Manufacturing Co." (slug `demo`)
- Site A: "Plant A – Manufacturing" — zones: Assembly (low), Loading Dock (medium),
  High Voltage Room (high), Paint Booth (high); equipment: Conveyor 3, Press 1,
  Forklift 2, Packaging Line.
- Site B: "Warehouse B" — zones: Racking (medium), Cold Storage (medium), Battery
  Charging (high); a few equipment items.
- Users (PIN `123456` for all seeded users in demo):
  - 1 admin (also used as manager in demo)
  - 2 supervisors at Site A (departments: Maintenance, Production), 1 at Site B
  - 3 real-phone workers at Site A (authorized for Assembly + Loading Dock only)
  - 15 simulated workers across both sites (`is_simulated = true`)
- Floor plans: simple generated PNGs in `public/floorplans/` (rectangles + labels) are fine.

---

## 9. Build plan (Codex tasks, in order)

Each task: small, named files, done when acceptance passes. Use a cheaper model for ⚙️
(boilerplate) tasks and the default model for 🧠 (logic) tasks.

**Phase 0 — Fri night (foundation)**
1. ⚙️ Scaffold Next.js + TS + Tailwind + Vitest + Supabase clients; npm scripts; env example.
2. 🧠 Migrations: schema §5 + enums + RLS helpers/policies + realtime publication.
3. ⚙️ Seed script §8.
4. 🧠 Auth: login (org + employee ID + PIN), demo buttons, `lib/auth.ts`, role routing,
   middleware protecting `/helmet`, `/dashboard`, `/setup`, `/demo`.
5. ⚙️ Deploy to Vercel; confirm phones can log in over HTTPS.

**Phase 1 — Sat morning (live pipe)**
6. 🧠 `lib/geometry.ts` + tests (pointInPolygon, centroid, distance, nearestWorkers).
7. 🧠 `lib/realtime.ts` + `components/FloorPlan.tsx` rendering zones, equipment, dots.
8. ⚙️ `/helmet` shell: start shift, heartbeat loop, SOS button, alert takeover component.
9. 🧠 `scripts/simulator.ts` (movement + heartbeats). **Milestone: dots move on dashboard.**

**Phase 2 — Sat afternoon (core safety logic)**
10. 🧠 F2 zone entry: `/helmet/scan`, `/api/zones/enter`, `lib/alerts.ts`, takeover.
11. 🧠 F3: motion detection, "Are you OK?" flow, `lib/escalation.ts` + tests, escalate,
    respond, watchdog.
12. ⚙️ AlertFeed with ack/resolve.

**Phase 3 — Sat night (LOTO + onboarding)**
13. 🧠 `lib/loto.ts` state machine + tests; ticket APIs; routing.
14. 🧠 `lib/openai.ts` parseHazardReport with JSON schema + timeout fallback.
15. ⚙️ Report Hazard UI, LotoBoard, ticket timeline.
16. ⚙️ `/setup/people`: list, Add User (PIN + login QR), edit zones, deactivate.

**Phase 4 — Sun morning (polish, feature freeze at noon)**
17. ⚙️ `/setup/sites`: floor plan upload, zone polygon editor, equipment placement,
    printable zone QR sheet.
18. ⚙️ Site switcher, headcount per zone, dashboard polish (dark theme, projector sizes).
19. ⚙️ `/demo` panel + reset.
20. Rehearse demo ×3, record backup video, print QR codes.

---

## 10. Demo script (~3 min)

Setup: laptop on projector (dashboard, Plant A); phones: Worker "Alex", Worker "Sam",
Supervisor "Jordan"; zone QR codes on table; simulator running; backup video ready.

1. **Problem (0:00–0:20)** — one real BLS/OSHA stat.
2. **Dashboard (0:20–0:35)** — busy live floor, zones, equipment.
3. **Onboarding (0:35–0:55)** — admin adds "Taylor", authorizes Assembly + Loading Dock,
   QR + PIN → teammate logs in → Taylor appears on map.
4. **LOTO (0:55–1:35)** — Alex types "conveyor 3 guard is cracked" → AI fills ticket →
   Jordan's phone buzzes → Alex applies lock → conveyor turns red → Sam tries release →
   denied (OSHA rule) → Jordan verifies.
5. **Zone (1:35–1:55)** — Taylor scans High Voltage Room QR → phone red takeover →
   zone pulses on dashboard.
6. **Man-down (1:55–2:40)** — Alex sets phone down → "Are you OK?" → no answer →
   Sam's phone: "Alex needs help, ~15 m away" → Responding → dashboard shows responder.
7. **Multi-site (2:40–2:45)** — switch to Warehouse B.
8. **Roadmap (2:45–3:00)** — BLE/UWB wearables, CSV onboarding, MSHA & construction,
   compliance reports.

Fallback: `/demo` buttons for every step; phone hotspot; backup video.
