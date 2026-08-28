# Architecture: Toolber

## System Overview
Toolber is a client-heavy PWA backed entirely by managed services — no custom server to operate. The React frontend talks directly to Supabase (Postgres + Auth + Storage + Realtime) via `supabase-js`, calls a small number of Postgres RPC functions for trust-sensitive logic, and uses one Supabase Edge Function to send transactional email through Resend. Mapbox renders search results client-side. A Cloudflare Worker in static-assets mode serves the built app at https://toolber.org and redeploys automatically on every push to the GitHub repo.

## Architecture Diagram
```
                    ┌──────────────────────────┐
                    │      Borrower's /         │
                    │      Lender's browser     │
                    │   (Toolber PWA, React)    │
                    └─────────────┬──────────────┘
                                  │ HTTPS
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
     ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐
     │  Cloudflare     │  │    Supabase     │  │   Mapbox GL JS   │
     │  Worker         │  │  (Postgres +    │  │  (client-side    │
     │  (static PWA    │  │   Auth + Storage│  │   map tiles)     │
     │   hosting)      │  │   + Realtime)   │  └─────────────────┘
     └────────────────┘  └────────┬────────┘
              ▲                    │
              │ git push           │ DB trigger on
              │                    │ notifications insert
     ┌────────┴────────┐           ▼
     │  GitHub repo     │  ┌─────────────────┐
     │  Platow-Apps/    │  │ Supabase Edge    │
     │  Toolber         │  │ Function: notify │
     └─────────────────┘  └────────┬────────┘
                                     │ HTTPS API call
                                     ▼
                            ┌─────────────────┐
                            │  Resend (email)  │
                            └─────────────────┘
```

## Components

### Toolber PWA (frontend)
- **Responsibility:** all UI — browse/search, list a tool, borrow request lifecycle, group management, profile/notification settings, favorites, map view, a floating feedback prompt, and an admin-gated internal analytics dashboard (`is_platform_admin` only)
- **Technology:** React + Vite, Tailwind, `lucide-react`, `supabase-js`, Mapbox GL JS
- **Interfaces:** Supabase client SDK (Postgres over PostgREST, Auth, Storage, Realtime subscriptions), Mapbox tile API

### Supabase (backend-as-a-service)
- **Responsibility:** persistence (Postgres), authentication (email+password), file storage (tool photos), real-time delivery of in-app notifications, and the RPC functions encoding trust-sensitive logic (approve/deny, pickup-location reveal, malfunction reporting)
- **Technology:** managed Postgres + Supabase's Auth/Storage/Realtime/Edge Function layers
- **Interfaces:** PostgREST-generated REST API (via `supabase-js`), RPC calls for custom functions, Realtime WebSocket channel for notifications, a database trigger that invokes the `notify` Edge Function on new `notifications` rows

### Supabase Edge Function: `notify`
- **Responsibility:** checks the recipient's `notification_preferences` for the relevant category, and if enabled, calls Resend to send the email
- **Technology:** Deno-based Supabase Edge Function
- **Interfaces:** invoked by a Postgres trigger/webhook on `notifications` insert; calls the Resend HTTP API

### Resend
- **Responsibility:** transactional email delivery (borrow requests, approvals, malfunction reports, meeting reminders, etc.)
- **Technology:** third-party email API
- **Interfaces:** HTTPS API, called only from the `notify` Edge Function (never from the client)

### Mapbox
- **Responsibility:** renders map pins for search results at approximate (group/neighborhood-level) precision
- **Technology:** Mapbox GL JS, client-side only
- **Interfaces:** tile/style API called directly from the browser with a public, scope-limited token

### Cloudflare Worker (static assets)
- **Responsibility:** hosts the built static PWA, auto-deploys on push to the connected GitHub branch
- **Technology:** a Cloudflare Worker named `toolber` in static-assets mode, configured by `wrangler.jsonc` (`not_found_handling: single-page-application`, which is what makes deep links like `/tool/:id` resolve instead of 404ing)
- **Interfaces:** watches `github.com/Platow-Apps/Toolber`; serves the `dist/` build output
- **Domains:** `toolber.org` (custom domain, live 2026-08-28) and `toolber.polished-rain-ca77.workers.dev` (kept as a fallback during the transition)
- **Headers:** `public/_headers` is honored by Workers static assets — CSP and the security headers are served from it, verified live

> **Note:** earlier revisions of this document described Cloudflare **Pages**. That was never what shipped; `wrangler.jsonc` has always configured a Workers deploy. Corrected 2026-08-28, closing audit CQ-7.

### GitHub
- **Responsibility:** source of truth for code, triggers Cloudflare Worker deploys
- **Interfaces:** standard git push/PR workflow

## Data Flow

**Chest approximate-pin setup (one-time, at profile completion or whenever the owner updates it):** owner enters their true location (`profiles.home_lat/home_lng`, never exposed to other users) and either picks a jitter radius or manually places a pin → if auto-jitter, the client (or an Edge Function) computes a uniformly-random offset point and calls Mapbox's Tilequery API to snap it to the nearest real street/intersection → the result is stored in `profiles.approx_lat/lng`. This computation runs once per change, never on read — see `technical-design.md` → Location & Privacy Model for why re-randomizing on every view is actively worse for privacy, not better.

**Search:** browser queries Supabase (PostgREST) for tools matching a keyword/type → results deduplicated by tool client-side (or via a view) → each result is plotted at its **owning chest's** persisted `approx_lat/lng` (never the group's, never the real pickup location) for Mapbox pin rendering. No sensitive location data is in this response path at all.

**Borrow request → approval → location reveal:**
1. Browser calls `request_borrow()` RPC
2. Postgres evaluates certification requirement, "vetted" status, and the lender's auto-approve setting; writes a `borrow_requests` row and a `notifications` row
3. A DB trigger on the `notifications` insert invokes the `notify` Edge Function
4. `notify` checks the recipient's preferences and calls Resend if the email channel is enabled for that category
5. In parallel, the lender's open browser session receives the notification instantly via a Supabase Realtime subscription
6. Lender calls `approve_borrow_request()` → sets `pickup_location_revealed_at`, flips tool status, writes another `notifications` row → same trigger → borrower notified in-app + email
7. Borrower's client can now call `get_pickup_location()` and render the pickup address with its privacy disclosure

**Malfunction report:** browser calls `report_malfunction()` → tool status flips atomically in the same transaction → owner notified through the same notification pipeline.

## Data Model
See [`technical-design.md`](technical-design.md#core-entities) for the full entity/field breakdown (`profiles`, `groups`, `group_memberships`, `tools`, `favorites`, `borrow_requests`, `tool_authorizations`, `tool_malfunction_reports`, `notification_preferences`, `notifications`). Two relationships worth restating here: a tool belongs to exactly one chest (`profiles` row) and a chest can belong to many groups, with a tool's group affiliation *derived* through its chest rather than stored directly; and certification/supervision status (`tool_authorizations`) is a standing relationship between one borrower and one tool, independent of any single borrow request.

## Infrastructure
- **Hosting:** a Cloudflare Worker in static-assets mode (frontend), Supabase-managed infrastructure (database, auth, storage, functions) — no servers Toolber operates directly
- **CI/CD:** GitHub → Cloudflare Worker auto-deploy on push; Supabase schema migrations tracked via the Supabase CLI and applied as part of the deploy process (or manually during this early phase — to be formalized)
- **Monitoring:** Supabase's built-in dashboard (query performance, auth logs, function logs) is sufficient at this stage; no separate observability stack needed yet
- **Logging:** Supabase Edge Function logs (for the `notify` function) and Postgres logs via the Supabase dashboard

## Security Architecture
- **Auth:** Supabase Auth, email+password, session tokens (JWT) issued by Supabase and used to authorize all PostgREST/RPC calls
- **Authorization:** Postgres Row Level Security (RLS) on every table; the one field requiring extra care beyond standard RLS is `tools.pickup_location`, which is excluded from general read access and exposed only through the `get_pickup_location()` `SECURITY DEFINER` function gated on an approved `borrow_requests` row (see `technical-design.md` → Security Considerations)
- **Secrets:** Resend API key and any Mapbox secret token live in Supabase Edge Function environment variables / the Worker's environment variables — never shipped to the client bundle (Mapbox's client-side token is a separate, scope-limited public token by design)
- **Network:** all traffic over HTTPS; no custom network infrastructure to secure since everything is managed-service-to-browser

## Scaling Strategy
Not a near-term concern — this phase targets the account holder plus trusted testers, not public scale. Supabase's free/pro tiers comfortably cover this. Revisit if/when Toolber has enough concurrent users that Supabase's connection pooling or Realtime channel limits become relevant; the schema and RPC-based approach for sensitive logic will carry forward without a rearchitecture.

## Disaster Recovery
Supabase provides automatic Postgres backups (frequency depends on plan tier — confirm current tier's retention window). No custom backup process exists yet. Given the pre-public-launch stage, formal RTO/RPO targets aren't defined; revisit before any real public rollout.

## Decision Log
| Decision | Rationale | Date |
|---|---|---|
| Supabase over Firebase/custom backend | User already had both accounts; Postgres + built-in Auth/Storage/Realtime covers every near-term need without standing up custom servers | 2026-08-13 |
| Email + password auth (not magic link / SMS OTP / social) | Magic link has a known mobile in-app-browser session-handoff problem; SMS OTP costs money per message; user wanted the simplest reliable option | 2026-08-13 |
| PWA first, native app wrap later | Existing `toolber.jsx` is a web app; App Store/Play Store can't accept it directly; PWA gets a real working product live fastest, native wrapping (Capacitor) deferred | 2026-08-13 |
| Cloudflare + existing GitHub repo | User already had both accounts set up | 2026-08-13 |
| Hosting is a Cloudflare **Worker** (static assets), not Pages | `wrangler.jsonc` had always configured a Workers deploy while the docs described Pages (audit CQ-7). Confirmed against the live deployment rather than the docs; Workers static assets also honors `public/_headers`, so nothing had to be ported | 2026-08-28 |
| Custom domain `toolber.org` | Real domain for launch; apex attached to the Worker as a custom domain, which created the DNS record and provisioned TLS. Required matching updates in Supabase Auth URLs, the Mapbox token's URL restrictions, and the Turnstile hostname list — each fails silently rather than loudly | 2026-08-28 |
| Resend for transactional email | Default recommendation; simple API, pairs cleanly with Supabase Edge Functions | 2026-08-13 |
| Groups are invite-code + admin approval only, no geo-verification | Matches how real-world tool libraries/Buy Nothing groups already work; avoids building geocoding/boundary logic for a trust problem a human admin already solves | 2026-08-13 |
| Tool sets/bundles are one atomic listing (no per-item tracking) | Avoids a nested-inventory data model for a feature that doesn't need that precision yet | 2026-08-13 |
| Malfunction reports auto-flip tool status to unavailable | Protects the next borrower by default; owner must actively clear it | 2026-08-13 |
| AI photo-based tool-name suggestion deferred | Requires a new vision-API integration and per-call cost; not core to the borrow/lend loop | 2026-08-13 |
| All borrow requests require owner approval (no fully self-service checkout), with an opt-in auto-approve for "vetted" borrowers | Owner wanted to preserve final say even within trusted groups ("some borrowers, even though they belong to a group, can be shady") while still allowing streamlining | 2026-08-13 |
| Pickup-location reveal is merged into borrow-request approval (no separate address-request step) | Simplifies the MVP's original two-step flow into one; approval to borrow and permission to know where the tool is are the same real-world event | 2026-08-13 |
| Single unified "pickup location" field, no home-address/exchange-point mode split | Simpler model; the lender already controls what location they put there, so a separate mode was redundant | 2026-08-13 |
| `delegated_approver_id` reserved as an inert placeholder column | Group-admin-facilitator idea is still just brainstormed; reserving the column avoids a schema retrofit later at effectively zero cost now | 2026-08-13 |
| Map pins are per-chest, persisted once, never regenerated on view | Group-level shared pins would stack every member's tools on one point; re-randomizing per view/session enables an averaging attack that reconstructs the true location from repeated samples. A single stored, owner-chosen (or auto-jittered + road-snapped) point per chest avoids both failure modes | 2026-08-13 |
| No app-wide default jitter radius — owner must explicitly set one (or manually place a pin) before their chest is listable/searchable | User's explicit call, from direct prior-app experience with this exact problem; avoids ever silently under-protecting someone's location | 2026-08-13 |
| Certification and supervision are independent, persistent per-borrower-per-tool state (`tool_authorizations`), not a one-time request checkbox | Being certified doesn't automatically remove a supervision requirement — that's always a separate, explicit owner decision, and it needs to persist across multiple future borrows of the same tool by the same person | 2026-08-13 |
| Groups get their own map pin (blue, larger teardrop) in addition to per-chest pins (red-orange) | Helps a searcher evaluate which group to join independent of any specific tool search | 2026-08-13 |
| Owners can opt out of the map entirely (`map_pin_hidden`) | Some owners may not want any geographic presence at all, even fuzzed; tools stay findable via list search regardless | 2026-08-13 |
| Reaffirmed: PWA first, Capacitor/native wrap later (not Flutter/React Native from the start) | Even with TestFlight, native distribution requires an Apple Developer Program membership, a Mac build pipeline, and a lightweight review pass for external testers — real friction against a fail-fast testing loop. A PWA is a shareable link with zero install/review friction on either platform, and the same build can still be wrapped into native apps later without a rewrite | 2026-08-13 |
| Analytics: self-hosted `events` table + internal dashboard, no third-party analytics vendor | Keeps usage data in the same Supabase project already trusted with sensitive location data, avoids adding another vendor/script, and ties directly to product decisions (funnel drop-off) rather than raw traffic counts | 2026-08-13 |
| Feedback: single free-text field, always-visible floating button | Lowest-friction way for early testers to surface anything, anytime, without hunting for a settings page | 2026-08-13 |
| Removed the borrower competency-certification system; risk acknowledgment moved to the ToS | A per-tool "I certify I'm able to use this safely" checkbox was judged condescending (no hardware store requires a competency waiver) and legally counterproductive — requiring/implying lender supervision can create an assumed duty of care, working against the lender. Replaced with a one-time ToS acknowledgment (both borrower and lender risk clauses) plus an opt-in, liability-free "I'd like a quick walkthrough" convenience checkbox. The stationary-tool supervised-access toggle stays, since its rationale (physical presence for immovable equipment) is unrelated to certifying competence. | 2026-08-14 |
| Category made optional; search relevance driven by Postgres full-text search (`tsvector` + `ts_rank_cd`), not category matching | Categorizing correctly is friction for lenders and doesn't solve the real problem (surfacing the best-matching tool for a query like "oil filter wrench" over a merely wrench-adjacent one) — that's a text-relevance problem Postgres already solves natively, no extra search service needed | 2026-08-13 |
