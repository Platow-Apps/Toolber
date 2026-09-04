# Toolber

## Overview
Toolber is a neighborhood tool-lending PWA — people maintain a personal "chest" of tools they'll lend, optionally join trusted "groups" for streamlined approval, and anyone with a verified account can search the whole app and request to borrow. Every borrow is owner-approved; a tool's precise pickup location is only revealed to a borrower once their specific request is approved. Free peer-to-peer at launch — no payments yet.

Full design context lives in [`docs/technical-design.md`](docs/technical-design.md) (entities, API, flows, security) and [`docs/architecture.md`](docs/architecture.md) (system diagram, infra, decision log). The running scope/decision tracker is [`docs/feature-checklist.md`](docs/feature-checklist.md) — check it before assuming something is or isn't in scope.

## Current State (important — read before touching code)
**The app is real.** Vite + React, Supabase-backed, rebuilt in the **Motorsport** visual direction, with a test suite (`npm run test:all`).
- `src/` — the actual app: routed screens in `pages/`, shared UI in `components/`, pure helpers in `lib/`. Wired to a live Supabase project.
- `docs/audit-2026-08-20.md` — **open findings. Read this before security or borrow-flow work.** The "before anything else ships" bucket (privilege escalation, borrow-flow status guards, invite-code exposure) is now fixed (0009, 0010, 0014). What's left is lower-priority: `create_group()`/`join_group()` polish, `RLS-1`/`RLS-2`, and moving the notify Edge Function's token into Vault (`SEC-1`'s remainder, `SEC-4`).
- `docs/` — the design of record. The 14 screen mockups referenced throughout `docs/feature-checklist.md` are the visual spec.
- `docs/prototype/` — the **frozen no-build CDN prototype**, historical reference only. Not built, not imported, excluded from every linter. Don't edit it expecting it to affect the real app.
- `supabase/migrations/` — schema, RLS policies, RPCs. `0001_init.sql` is the base; `0002`–`0006` are incremental fixes. Applied to the live project.
- `supabase/functions/notify/` — the email-notification Edge Function. Not yet deployed.

## Quick Start

### Prerequisites
- Node.js LTS (already installed on the dev machine this was scaffolded on)
- A Supabase project (free tier) — URL + anon key, then apply `supabase/migrations/0001_init.sql`
- Mapbox public token
- Resend API key (set as a Supabase secret for the `notify` Edge Function — never a client-side env var)
- Copy `.env.example` to `.env` and fill in the Supabase/Mapbox values

### Running the frozen prototype (reference only)
```
pwsh docs/prototype/serve.ps1
```
Visual/interaction reference only — no persistence, not the real app.

### Key Commands
- Dev server: `npm run dev`
- Build: `npm run build`
- Preview a production build: `npm run preview`
- **Everything: `npm run test:all`** — runs the whole gate chain below, in order, stopping at the first failure
- Unit/component tests: `npm run test:ava` (`test:ava:watch`, `test:ava:coverage`)
- Database RLS tests: `supabase test db` (pgTAP; needs Docker + `supabase start`, not part of `test:all`)
- Lint: `npm run test:lint` (biome) — `npm run lint` still runs the older eslint config

## Project Structure
```
Toolber/
├── src/
│   ├── main.jsx               # Vite entry point (ErrorBoundary → Router → AuthProvider → App)
│   ├── App.jsx                # route table; renders ConfigError when env vars are missing
│   ├── index.css              # Tailwind directives + the root font-size scale (do NOT reintroduce `zoom`)
│   ├── contexts/
│   │   └── AuthContext.jsx    # session + profile, the only reader of the `profiles` table
│   ├── components/            # shared UI: ToolCard, BottomNav, BrandBar, ToolMap, guards, ErrorBoundary
│   ├── pages/                 # one file per route
│   └── lib/
│       ├── supabaseClient.js  # supabase-js client, reads VITE_SUPABASE_* env vars
│       ├── analytics.js       # logEvent + the EVENTS vocabulary — use this, not a raw events insert
│       ├── toolStatus.js      # status pills + price formatting, shared by every tool list
│       ├── mapPins.js         # pure map-pin maths, split out of ToolMap so it is testable
│       ├── geo.js             # haversine distance for "Find a Group"
│       └── inviteCode.js      # crypto-random group invite codes
├── test/
│   ├── setup.jsx              # render helpers (renderPage / renderWithRouter / renderWithAuth)
│   └── support/               # Supabase double + the ESM resolve hook that installs it
├── scripts/
│   ├── test-all.sh            # the gate chain behind `npm run test:all`
│   └── test-no-direct-pickup-location.sh
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql      # full schema, RLS, RPCs — source of truth is docs/technical-design.md
│   └── functions/
│       └── notify/            # Edge Function: checks notification_preferences, sends via Resend
├── public/
│   ├── favicon.svg
│   ├── icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon-180.png
│   └── _headers               # CSP + security headers — honored by Workers static assets
├── index.html                 # Vite HTML entry
├── vite.config.js             # React + vite-plugin-pwa (mapbox is runtime-cached, not precached)
├── tailwind.config.js
├── biome.json / knip.json / tsconfig.json / .semgrepignore
├── .env.example                # copy to .env, never commit the real one
├── docs/
│   ├── audit-2026-08-20.md    # open findings — read before security/borrow-flow work
│   ├── technical-design.md    # entities, API, flows, security, migration plan
│   ├── architecture.md        # system diagram, component responsibilities, decision log
│   ├── feature-checklist.md   # living scope tracker — update as decisions change, links every screen mockup
│   └── prototype/             # frozen CDN prototype, historical reference only
├── .claude/
│   ├── launch.json             # dev server config for the preview tool
│   └── skills/
│       └── project-discovery/  # the discovery skill used to produce docs/
└── CLAUDE.md                  # this file
```

## Architecture
Frontend (React PWA) talks directly to Supabase (Postgres + Auth + Storage + Realtime) via `supabase-js`, using Postgres RPC functions for anything trust-sensitive (borrow approval, pickup-location reveal, malfunction reporting). Mapbox renders search results client-side. A Supabase Edge Function sends email via Resend, triggered by a DB trigger on notification inserts. A Cloudflare **Worker** (`toolber`, static-assets mode) hosts the built app at **https://toolber.org**, deploying from `github.com/Platow-Apps/Toolber`. Full detail and diagram in [`docs/architecture.md`](docs/architecture.md).

## Coding Standards
- **Motorsport theme colours live in `tailwind.config.js`** (`asphalt`, `safety`, `racing`, `signal`, …). Use the named colours, not raw hex, and Tailwind utilities for layout.
- **Icons are hand-written inline SVG**, sized with Tailwind and marked `aria-hidden="true"` unless the icon is the only content of a control — in which case give the control an `aria-label`. There is no icon library (`lucide-react` was an unused dependency and has been removed).
- **Sizes go in `rem`, never `px`.** The whole UI is scaled by `html { font-size: 108% }` in `index.css`, which only works through rem. `text-[0.844rem]`, not `text-[13.5px]`. Never reintroduce CSS `zoom` — it breaks Mapbox's pointer maths and the installed PWA's viewport height.
- **Reuse `ToolCard` for any list of tools**, and `lib/toolStatus.js` for status pills and prices. Four screens used to carry their own copy.
- Keep Postgres RPC functions as the single place trust-sensitive logic lives — don't replicate approval/reveal logic in the frontend beyond calling the RPC and rendering its result
- No raw SQL string-building in the client — use `supabase-js` query builders / RPC calls only
- **Surface every error.** `if (!error) { … }` with no `else` produces a control that silently does nothing; six of those were fixed in the audit pass.

## Patterns to Follow
- **Pickup location handling:** never query `tools.pickup_location` directly from the client. It must go through `get_pickup_location()`, which enforces the approved-request check server-side. If you ever see a code path reading that column outside that RPC, that's a security bug — see `docs/technical-design.md` → Security Considerations.
- **Notifications:** every user-facing event (borrow request, approval, malfunction, etc.) writes a `notifications` row; email delivery is a side effect of that insert (via trigger → Edge Function → Resend), not something the frontend calls directly.
- **Group affiliation is derived, not stored on the tool** — a tool's group(s) come from `chest_id → group_memberships → groups`. Don't add a direct tool↔group column; it'll drift from the membership table.
- **Log an `events` row for every meaningful new user action you add**, via `logEvent()` from `src/lib/analytics.js` — never a raw `from("events").insert(...)`. Add the name to the `EVENTS` map there first. This is the entire analytics strategy (no third-party vendor), so a feature that doesn't log its key actions is invisible on the internal dashboard. `logEvent` never throws and no-ops for signed-out visitors, because the insert policy requires `profile_id = auth.uid()`.

## Common Pitfalls
- The frozen prototype (`docs/prototype/`) scopes search to a single hardcoded group (`oakhill`) and reveals addresses via a *separate* request/approve step from borrowing. **Both of these are intentionally different in the real design**: search is global, and pickup-location reveal is merged into borrow-request approval (one step, not two). Don't carry the MVP's old behavior forward by habit.
- `delegated_approver_id` on `borrow_requests` exists in the schema but has **no logic attached** — it's a reserved placeholder for a not-yet-specified group-admin-facilitator feature. Don't build against it without checking `docs/feature-checklist.md` first for whether it's been specified yet.
- Tool sets/bundles are atomic (one status for the whole set) — don't build per-item tracking inside a set; that was explicitly decided against.
- "Vetted" borrower status = shares an approved group with the lender, **or** has a payment method on file (that second clause is dormant until payments ship — don't gate anything on it yet since `has_payment_method_on_file` will always be false pre-launch).
- **There is no borrower competency-certification system — don't reintroduce one.** It was deliberately removed: a per-tool "I certify I'm able to use this safely" checkbox was condescending and legally counterproductive (implying lender supervision can create an assumed duty of care). Risk acknowledgment lives in the ToS instead. The one thing that *does* still exist is `tool_authorizations.supervision_required` — a standing per-(borrower, tool) record, but purely about whether the owner needs to be physically present for a **stationary** tool, unrelated to competence. It persists across requests until the owner explicitly changes it via `set_borrower_supervision()`.
- The optional "I'd like a quick walkthrough on using this tool" checkbox (`borrow_requests.wants_instruction`) is a convenience signal only — don't wire any approval/gating logic to it.
- **Rebuilding `tools.search_vector` drops its column grants.** A generated column's expression cannot be altered in place, so changing it means `DROP COLUMN` + `ADD COLUMN` — and dropping a column takes its privileges with it. Any migration that rebuilds it must also re-run `grant select (search_vector) on tools to anon, authenticated;`. Missing it fails as "permission denied for table tools" on every *typed* search while an empty search still works, because `.textSearch()` filters on that column and filtering needs SELECT on it. This has bitten twice (0026, 0029); fixed in 0031, which verifies the grant rather than assuming it.
- **A column-level `REVOKE` does nothing while a table-level `SELECT` grant stands.** `revoke select (col) on t from authenticated` looks like it protects a column and silently doesn't — if the role holds SELECT on the whole table, it still reads every column. The only shape that works is `revoke select on t from public, anon, authenticated` followed by `grant select (explicit, column, list) on t to authenticated`, which is what 0001 does for `tools` and `profiles` and what 0035 does for `borrow_requests`. Enumerate the *allowed* columns rather than excluding the forbidden one: a column added later is then unreadable until granted (fails loudly) instead of exposed by default (fails silently). And remember the other half — dropping the table grant takes every ordinary column with it, so anything the client selects or **filters on** must be in the list, or it fails as "permission denied for table …".

- **The column-grant trap has an UPDATE half, and it is easier to miss.** 0009 revoked table-level UPDATE on `profiles` and granted an explicit column list (so nobody can set `is_platform_admin` on themselves). Every column added since must be named in `grant update (…) on profiles` or it is silently unwritable — which bit `share_email_on_approval`/`share_phone_on_approval` (0033) and `chest_public` (0038), all three fixed in 0039. It presents as a **stuck control**, not an error: Settings updates optimistically and reverts on failure, so the checkbox moves, the write is refused, and it moves back. When adding a user-editable column to `profiles` or `tools`, grant SELECT *and* UPDATE, and surface the error client-side so the next one announces itself.

- **`revoke execute ... from public` does not keep `anon` out, and 35 migrations believed it did.** Supabase ships default privileges granting EXECUTE on every new function in `public` to `anon`, `authenticated` and `service_role` **explicitly** — not through PUBLIC. So revoking PUBLIC removes a grant that was never the one letting anon in, and the explicit `anon=X` stands. This is the function-level twin of the column-grant trap below: a REVOKE that reads like protection, changes nothing, and leaves no trace of having failed. The working shape is `revoke execute on function f(args) from public, anon;`. 0046 sweeps every existing function and sets `alter default privileges in schema public revoke execute on functions from anon`, so a function that should be public now has to say so. What saved this from being an incident is that 26 function bodies open with `if auth.uid() is null then raise exception` — the defence was one layer deep instead of two, everywhere.

- **A pgTAP `SET LOCAL ROLE anon` does not clear `request.jwt.claims`.** The claim survives from the previous block, so `auth.uid()` keeps returning that user and every "as anon" assertion runs as somebody signed in. Two suites asserted anon was locked out of `join_group`, `request_to_join_group` and `get_pickup_location` and passed for years while anon genuinely held EXECUTE on all three. Always `RESET ROLE; SET LOCAL request.jwt.claims = '{"role":"anon"}'; SET LOCAL ROLE anon;`.

- **`supabase test db` runs against whatever the local stack already has — it does not apply migrations.** Use `supabase db reset && supabase test db`. A stack left running from before a migration reports that migration's functions as "does not exist", which reads like a broken feature. More importantly, **a database built incrementally is not the database the migrations build**: resetting is what exposed the anon-EXECUTE gap above, because four assertions that passed against the hand-grown schema failed against a scratch build. Reset before believing a green suite.

- **A pgTAP `throws_ok` with a NULL error code accepts *any* error, including "function does not exist".** Six validation assertions passed against a database where the function under test was absent. Name the SQLSTATE — `P0001` for a bare `raise exception`, `42501` for a refused EXECUTE. Same for `isnt(NULL, x)`, which succeeds: an assertion like "the public pin is never the real position" proves nothing when the write never happened, so pair it with an explicit `IS NOT NULL`.

- **Pin the Supabase CLI, and suspect it before your own diff.** The npm scripts called plain `supabase`, so `npx` fetched whatever was newest at the moment anyone ran them. 2.115.0 shipped a bundler bug that failed `functions deploy` with nothing but "An error occurred in Effect.tryPromise" after "Bundling Function" — no message, no stack. The same source deploys cleanly on 2.116.0, which the scripts now pin. The tell that it was not the code: deploying an **untouched** second function fails identically. Run that control early — one command settles "my change" versus "the tool" outright, and skipping it cost about an hour of searching a clean diff.

- **postgrest-js parses the `.select()` string in the type system.** A template literal with a runtime-chosen column resolves to a `ParserError` rather than a row type, so the other selected fields "do not exist" and the build fails. Select `'*'` and index off a `Record<string, boolean>` when a column name is dynamic. This is invisible to `npm run test:all` for Edge Functions — `npm run test:functions` type-checks them, and needs `--node-modules-dir=none` because Deno otherwise finds the app's `package.json` and cannot resolve the Supabase npm deps. Do **not** solve that with a `deno.json` next to the functions: `supabase functions deploy` reads that file as its bundle config, so a file added for a local check can break the deploy.

- **Map pins are per-chest, not per-group, and must never be regenerated on read.** Each chest's `approx_lat/lng` is computed once (auto-jitter + road-snap, or manual placement) and persisted. Plotting all of a group's tools at the group's own `approx_lat/lng` will stack pins; recomputing a chest's jitter on every page load (instead of storing it) reintroduces an averaging attack that can reconstruct the real location from repeated samples. See `docs/technical-design.md` → Location & Privacy Model before touching anything map-related.

## Testing
`npm run test:all` (→ `scripts/test-all.sh`) is the single command. It runs seven gates in order:

| Gate | Command | What it protects |
|---|---|---|
| `test:no-direct-pickup-location` | `scripts/test-no-direct-pickup-location.sh` | Fails if any file in `src/` *reads* `pickup_location`, `home_lat` or `home_lng`. Owner writes are allowed; only reads are the violation. This is the project's central invariant — see Patterns to Follow. |
| `test:lint` | `biome lint .` | Code health. The a11y backlog is downgraded to `warn` in `biome.json`; promote each rule back to `error` as it is cleared. |
| `test:types` | `tsc --noEmit` | Syntax + module resolution. `checkJs` is off — see TYPE-1 in the audit. |
| `test:knip` | `knip` | Unused files, exports and dependencies. |
| `test:security` | `semgrep scan --config auto` | SAST. `.semgrepignore` excludes the frozen prototype. |
| `test:audit` | `npm audit --audit-level high` | Dependency advisories. |
| `test:ava` | `ava` | 183 unit/component tests. |

**AVA suite** — `test/setup.jsx` renders a screen the way the app does (MemoryRouter + the real `AuthProvider`, mounted only once the session resolves) with the Supabase singleton swapped out. The swap is a Node ESM resolve hook (`test/support/mock-supabase.mjs`) that points every import of `src/lib/supabaseClient.js` at `test/support/supabase-double.js`, so no source file needs a test-only seam. Use `renderPage()` for anything behind `RequireAuth`, `renderWithRouter()` for presentational components. Note `ava.workerThreads` is `false` in `package.json`: `--import` loaders (tsx, jsdom, the Supabase hook) do not apply inside ava's worker threads, and `.jsx` fails to load without them.

**pgTAP suite** — `supabase/tests/*.sql`, run with `supabase test db` (needs Docker; there is deliberately no npm script for it, since it cannot run without a local stack). The AVA suite mocks Supabase and therefore cannot test a single RLS policy, column grant, or RPC guard; that is entirely what these files are for. `pickup_location_rls_test.sql` proves the pickup/home-coordinate boundary; `borrow_and_group_rls_test.sql` covers the row policies and RPC authorization. Assertions inside its `todo_start`/`todo_end` block encode intended behaviour that the schema does not have yet (audit findings PRIV-1, PRIV-2, DOS-1) — unwrap each as it is fixed.

**Open findings:** [`docs/audit-2026-08-20.md`](docs/audit-2026-08-20.md). Read it before starting security- or borrow-flow work.

Still manual: a walkthrough of `docs/feature-checklist.md`'s "Core loop" section before each milestone, and anything visual (the three map/PWA bugs in the audit were all found by hand).

## Deployment
- `.github/workflows/ci.yml` runs the full gate chain plus a build on every push and PR. It needs three repo secrets to build: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAPBOX_TOKEN`.
- **Live at https://toolber.org.** Hosting is a Cloudflare **Worker** named `toolber` in static-assets mode (`wrangler.jsonc`), auto-deploying from `github.com/Platow-Apps/Toolber`. This resolves audit CQ-7 — the earlier Pages-vs-Workers ambiguity in the docs was stale; Workers is what is actually deployed. `toolber.polished-rain-ca77.workers.dev` still serves the same Worker and is kept as a fallback during the domain transition.
- **A custom domain touches three other services, none of which fail loudly.** Supabase Auth (Site URL + Redirect URLs, or confirmation emails silently point at the old host), the Mapbox token's URL restrictions (`toolber-public`, or Map View goes blank with 403s), and the Turnstile widget's hostname list (a mismatch blocks *all* auth, not just signup). All three are configured for toolber.org as of 2026-08-28.
- `public/_headers` carries the CSP and security headers. Workers static assets reads it from the build output root — **verified live** on toolber.org (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, nosniff all present). If you move to a host that doesn't support it, port them to that host's mechanism.
- Supabase schema: `npm run supabase:db:push` (`:dry-run` first) or paste the migration into the SQL editor. Deploy the Edge Function separately: `npm run supabase:functions:deploy`, then `supabase secrets set RESEND_API_KEY=...`.
- The `on_notification_created` trigger's Edge Function URL/auth header in `0001_init.sql` are placeholders (`YOUR_PROJECT_REF`, `YOUR_SERVICE_ROLE_OR_ANON_KEY`). **Do not paste a service-role key there** — function bodies are readable by any logged-in user via `pg_proc`. Use Vault; see audit SEC-1.
