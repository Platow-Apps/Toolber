# Toolber

## Overview
Toolber is a neighborhood tool-lending PWA — people maintain a personal "crib" of tools they'll lend, optionally join trusted "groups" for streamlined approval, and anyone with a verified account can search the whole app and request to borrow. Every borrow is owner-approved; a tool's precise pickup location is only revealed to a borrower once their specific request is approved. Free peer-to-peer at launch — no payments yet.

Full design context lives in [`docs/technical-design.md`](docs/technical-design.md) (entities, API, flows, security) and [`docs/architecture.md`](docs/architecture.md) (system diagram, infra, decision log). The running scope/decision tracker is [`docs/feature-checklist.md`](docs/feature-checklist.md) — check it before assuming something is or isn't in scope.

## Current State (important — read before touching code)
**Scaffolding is done.** This is now a real Vite + React project (`package.json`, `src/`, the works). Three things coexist:
- `src/App.jsx` — the **ported MVP**, currently still the old pegboard/hardware-store visual language with in-memory `SEED_TOOLS`/`GROUPS` state. This is the literal starting point per the Migration Plan, not yet rebuilt in the chosen **Motorsport** visual direction and not yet wired to Supabase. Expect to replace this incrementally, screen by screen, following the mockups.
- `toolber.jsx` (root) and `mvp/` — the **original no-build CDN prototype**, kept only as a historical/visual reference. Not part of the build, not imported by anything in `src/`. Don't edit these expecting it to affect the real app.
- `docs/` — the target design. The 14 screen mockups referenced throughout `docs/feature-checklist.md` (Motorsport direction) are the actual visual spec for what `src/` should become — `App.jsx` has not caught up to them yet.
- `supabase/migrations/0001_init.sql` — the full schema, RLS policies, and RPC functions, written directly from `docs/technical-design.md`. Not yet applied to a real Supabase project (that's a `supabase db push` / SQL-editor-paste step once a project exists).
- `supabase/functions/notify/` — the email-notification Edge Function. Not yet deployed.

## Quick Start

### Prerequisites
- Node.js LTS (already installed on the dev machine this was scaffolded on)
- A Supabase project (free tier) — URL + anon key, then apply `supabase/migrations/0001_init.sql`
- Mapbox public token
- Resend API key (set as a Supabase secret for the `notify` Edge Function — never a client-side env var)
- Copy `.env.example` to `.env` and fill in the Supabase/Mapbox values

### Running the current MVP prototype (no build step, reference only)
```
pwsh mvp/serve.ps1
```
Serves `mvp/` at `http://localhost:5173`. Visual/interaction reference only — no persistence, not the real app.

### Key Commands
- Dev server: `npm run dev`
- Build: `npm run build`
- Preview a production build: `npm run preview`
- Lint: `npm run lint`
- Tests: not yet configured (see Testing below)

## Project Structure
```
Toolber/
├── src/
│   ├── main.jsx              # Vite entry point
│   ├── App.jsx                # ported MVP — not yet rebuilt in the Motorsport direction or wired to Supabase
│   ├── index.css              # Tailwind directives
│   └── lib/
│       └── supabaseClient.js  # supabase-js client, reads VITE_SUPABASE_* env vars
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql      # full schema, RLS, RPCs — source of truth is docs/technical-design.md
│   └── functions/
│       └── notify/            # Edge Function: checks notification_preferences, sends via Resend
├── public/
│   └── favicon.svg
├── index.html                 # Vite HTML entry
├── vite.config.js             # React + vite-plugin-pwa
├── tailwind.config.js
├── .env.example                # copy to .env, never commit the real one
├── toolber.jsx                # MVP prototype, single-file (historical reference only, not built)
├── mvp/
│   ├── app.jsx                 # same MVP, served standalone
│   ├── index.html              # CDN-based dev harness (Babel/esm.sh/Tailwind CDN)
│   └── serve.ps1               # tiny local static file server
├── docs/
│   ├── technical-design.md    # entities, API, flows, security, migration plan
│   ├── architecture.md        # system diagram, component responsibilities, decision log
│   └── feature-checklist.md   # living scope tracker — update as decisions change, links every screen mockup
├── .claude/
│   ├── launch.json             # dev server config for the preview tool
│   └── skills/
│       └── project-discovery/  # the discovery skill used to produce docs/
└── CLAUDE.md                  # this file
```

## Architecture
Frontend (React PWA) talks directly to Supabase (Postgres + Auth + Storage + Realtime) via `supabase-js`, using Postgres RPC functions for anything trust-sensitive (borrow approval, pickup-location reveal, malfunction reporting). Mapbox renders search results client-side. A Supabase Edge Function sends email via Resend, triggered by a DB trigger on notification inserts. Cloudflare Pages hosts the built static app, deploying from `github.com/Platow-Apps/Toolber`. Full detail and diagram in [`docs/architecture.md`](docs/architecture.md).

## Coding Standards
- Match the existing visual/component style already established in `toolber.jsx` (inline style objects for the pegboard/hardware-store theme colors, Tailwind utility classes for layout, `lucide-react` for icons) unless a real design system replaces it later
- Keep Postgres RPC functions as the single place trust-sensitive logic lives — don't replicate approval/reveal logic in the frontend beyond calling the RPC and rendering its result
- No raw SQL string-building in the client — use `supabase-js` query builders / RPC calls only

## Patterns to Follow
- **Pickup location handling:** never query `tools.pickup_location` directly from the client. It must go through `get_pickup_location()`, which enforces the approved-request check server-side. If you ever see a code path reading that column outside that RPC, that's a security bug — see `docs/technical-design.md` → Security Considerations.
- **Notifications:** every user-facing event (borrow request, approval, malfunction, etc.) writes a `notifications` row; email delivery is a side effect of that insert (via trigger → Edge Function → Resend), not something the frontend calls directly.
- **Group affiliation is derived, not stored on the tool** — a tool's group(s) come from `crib_id → group_memberships → groups`. Don't add a direct tool↔group column; it'll drift from the membership table.
- **Log an `events` row for every meaningful new user action you add.** This is the entire analytics strategy (no third-party vendor) — a feature that doesn't log its key actions is invisible on the internal dashboard. Check `docs/technical-design.md` → Analytics & feedback for the existing event types before inventing a new naming convention.

## Common Pitfalls
- The MVP's `toolber.jsx` scopes search to a single hardcoded group (`oakhill`) and reveals addresses via a *separate* request/approve step from borrowing. **Both of these are intentionally different in the real design**: search is global, and pickup-location reveal is merged into borrow-request approval (one step, not two). Don't carry the MVP's old behavior forward by habit.
- `delegated_approver_id` on `borrow_requests` exists in the schema but has **no logic attached** — it's a reserved placeholder for a not-yet-specified group-admin-facilitator feature. Don't build against it without checking `docs/feature-checklist.md` first for whether it's been specified yet.
- Tool sets/bundles are atomic (one status for the whole set) — don't build per-item tracking inside a set; that was explicitly decided against.
- "Vetted" borrower status = shares an approved group with the lender, **or** has a payment method on file (that second clause is dormant until payments ship — don't gate anything on it yet since `has_payment_method_on_file` will always be false pre-launch).
- **There is no borrower competency-certification system — don't reintroduce one.** It was deliberately removed: a per-tool "I certify I'm able to use this safely" checkbox was condescending and legally counterproductive (implying lender supervision can create an assumed duty of care). Risk acknowledgment lives in the ToS instead. The one thing that *does* still exist is `tool_authorizations.supervision_required` — a standing per-(borrower, tool) record, but purely about whether the owner needs to be physically present for a **stationary** tool, unrelated to competence. It persists across requests until the owner explicitly changes it via `set_borrower_supervision()`.
- The optional "I'd like a quick walkthrough on using this tool" checkbox (`borrow_requests.wants_instruction`) is a convenience signal only — don't wire any approval/gating logic to it.
- **Map pins are per-crib, not per-group, and must never be regenerated on read.** Each crib's `approx_lat/lng` is computed once (auto-jitter + road-snap, or manual placement) and persisted. Plotting all of a group's tools at the group's own `approx_lat/lng` will stack pins; recomputing a crib's jitter on every page load (instead of storing it) reintroduces an averaging attack that can reconstruct the real location from repeated samples. See `docs/technical-design.md` → Location & Privacy Model before touching anything map-related.

## Testing
- Not yet set up. Planned: pgTAP/scripted RLS tests (especially proving `pickup_location` is unreachable outside an approved request — the column-level `GRANT`/`REVOKE` in `0001_init.sql` is the mechanism to verify), Vitest + React Testing Library for components, manual walkthrough of `docs/feature-checklist.md`'s "Core loop" section before each milestone.

## Deployment
- Push to `main` on `github.com/Platow-Apps/Toolber` → Cloudflare Pages auto-builds and deploys. Not yet configured — this is a pending setup step, not an existing pipeline.
- Supabase schema: `supabase db push` (once a Supabase project + CLI link exists) or paste `supabase/migrations/0001_init.sql` into the SQL editor. Deploy the Edge Function separately: `supabase functions deploy notify`, then `supabase secrets set RESEND_API_KEY=...`.
- The `on_notification_created` trigger's Edge Function URL/auth header in `0001_init.sql` are placeholders (`YOUR_PROJECT_REF`, `YOUR_SERVICE_ROLE_OR_ANON_KEY`) — must be filled in with real project values once the Supabase project exists.
