# Technical Design: Toolber

> **Status:** re-read against the code and corrected on 2026-08-28. This document
> now describes the app **as built and deployed**, not a forward-looking spec.
> Where something is designed but not built, it says so explicitly. Migration
> numbers in parentheses (e.g. 0024) point at the `supabase/migrations/` file
> that introduced a behaviour.

## Overview
Toolber is a neighborhood/community tool-lending app. People maintain a personal inventory of tools ("chest") they're willing to lend, optionally join trusted "groups" (borrowing circles) for a higher level of default trust, and anyone with a verified account can search the entire app for a tool and request to borrow it. Every borrow is owner-approved; a tool's precise pickup location is only ever revealed to a borrower after their specific request is approved. Launch is free peer-to-peer lending — no money changes hands yet.

## Problem Statement
People buy tools they'll use once or twice a year, while a neighbor two doors down owns the exact thing and would happily lend it — if they knew each other, and if there were a low-friction, reasonably safe way to ask, agree on terms, and hand it off. Toolber's existing MVP (`toolber.jsx`) already proves out the interaction design (pegboard/hardware-store visual language, request/approve flows, address-gated privacy); this document specifies the real backend behind it.

## Goals & Non-Goals

### Goals
- A working, installable **PWA** with real persisted data (Supabase), replacing the MVP's in-memory seed data
- Global search across every listed tool, with results plotted on a **Mapbox** map at approximate precision
- A trust model where **groups streamline approval** (auto-approve eligibility) without ever fully removing the owner's manual gate
- A tool's precise **pickup location** is disclosed only after that borrower's specific request is approved — never before
- In-app + email notifications, user-toggleable by category
- Support for tool **sets/bundles** and **stationary/supervised** equipment
- A living, expandable feature set — the schema should absorb near-term additions (drop-off location, delegated approver, AI tool-ID) without a redesign

### Non-Goals (this phase)
- No payment processing / no money changing hands (Stripe Connect and the 10% platform fee are deferred)
- No native iOS/Android app store submission (PWA first; Capacitor wrap is a later phase)
- No push notifications (relies on in-app Realtime + email until native-wrapped)
- No geo-verification of addresses against neighborhood boundaries — groups are invite-code + manual admin approval only
- No AI photo-based tool name suggestion yet (backlog)
- No real-time scheduling/calendar system for "supervised" tool access — manual coordination only
- No delegated group-admin approval logic — a placeholder column is reserved, nothing more
- No drop-off location field yet — pickup location only, drop-off planned as a later addition
- No ratings/reviews/dispute-resolution system yet
- **No borrower competency-certification system.** Reconsidered and removed — a per-tool "I certify I'm able to use this safely" attestation was judged condescending (nobody signs a competency waiver buying a tool at a hardware store) and legally counterproductive (requiring/implying lender supervision can create an assumed duty of care, working against the lender rather than protecting them). Risk acknowledgment now lives in the ToS, accepted once, not re-litigated per borrow.

## Proposed Solution
Supabase provides Postgres (schema below), Auth (email+password), Storage (tool photos), and Realtime (in-app notification delivery) as one managed backend. The frontend is a Vite + React project (the original single-file CDN prototype is frozen at `docs/prototype/`, reference only) and talks to Supabase directly via `supabase-js`, with a small number of Postgres RPC functions handling logic that needs to run with elevated/validated privileges (approving a request, revealing a pickup location, filing a malfunction report). Mapbox renders search results; Resend sends notification emails, triggered from a Supabase Edge Function.

## Detailed Design

### Core Entities

**profiles** (1:1 with Supabase `auth.users`; also serves as the "chest" owner record — see note below)
| field | type | notes |
|---|---|---|
| id | uuid, PK | = `auth.users.id` |
| display_name | text | |
| avatar_url | text, nullable | Supabase Storage path |
| home_lat / home_lng | numeric, nullable, **never exposed to clients** | true base location, private — exists only to compute `approx_lat/lng`; same protection tier as `tools.pickup_location` |
| approx_lat / approx_lng | numeric, nullable | the chest's **public** map pin — see Location & Privacy Model below. Required (non-null) before the chest can list tools or appear in search |
| pin_radius_meters | numeric, nullable | owner-chosen jitter radius — **no app-wide default**, must be explicitly set. UI label: "Random pin proximity." |
| pin_placement_mode | enum: auto_jitter / manual | whether `approx_lat/lng` was algorithmically generated or hand-placed by the owner. **UI label for `auto_jitter` is "Random Pin"**, not the technical term "Auto-jitter" — reads better to users. The enum value itself stays as-is; this is a display-copy distinction only. |
| map_pin_hidden | bool, default false | owner can opt out of map display entirely — tool(s) still appear in the textual list-view search results, just with no map pin |
| profile_complete | bool | required fields filled in, **including an approximate-location choice** — gates search/listing access |
| tos_accepted_at | timestamptz, nullable | |
| tos_version | text, nullable | |
| auto_approve_vetted_borrowers | bool, default false | chest-level setting: auto-approve borrow requests from "vetted" borrowers (see Vetted definition) |
| has_payment_method_on_file | bool, default false | reserved for monetization phase; contributes to "vetted" once active |
| is_platform_admin | bool, default false | gates access to the internal analytics/feedback dashboard — distinct from a *group* admin, this is app-owner-level |
| theme_preference | enum: light / dark / system, default system | drives light/dark mode; synced so it's consistent across the user's devices, not just local to one browser |
| created_at | timestamptz | |

> **Design note:** a "chest" is modeled as the `profiles` row itself, not a separate table — the product concept is always exactly one chest per user. `tools.chest_id` references `profiles.id`. If Toolber ever needs multi-owner or organizational chests, this is the seam to split it out.

**groups**
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| name | text | |
| neighborhood_label | text | display name, e.g. "Oak Hill" |
| city | text, nullable | structured field, distinct from the free-text neighborhood label — needed for proper city-level search |
| zip_code | text, nullable | structured field for zip-level search; stored as text (not numeric) to preserve leading zeros |
| invite_code | text, unique | |
| admin_id | uuid, FK → profiles | |
| default_exchange_location | text/geo, nullable | convenience suggestion, not enforced |
| approx_lat / approx_lng | numeric, nullable | admin-settable general reference point for the group (e.g. "center the map here when browsing this group"). **Not** what individual tool pins are plotted at — see Location & Privacy Model |
| created_at | timestamptz | |

**group_memberships**
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| group_id | uuid, FK → groups | |
| profile_id | uuid, FK → profiles | the chest joining |
| status | enum: pending / approved / denied | |
| denial_reason | text, nullable | optional note from the lender, shown to the borrower (0011) |
| requested_days | integer, nullable, 1–365 | how long the borrower asked for; the owner may adjust it at approval (0024) |
| due_at | timestamptz, nullable | authoritative return date, set at approval = now() + agreed days (0024) |
| overdue_reminded_at | timestamptz, nullable | last time the overdue sweep notified about this loan; gates the every-3-days repeat (0025) |
| requested_at, decided_at | timestamptz | |

Single membership type — there's no separate "searcher" vs. "tool chest owner" join. Searching and listing are both available to any verified account regardless of group membership; joining a group is purely the optional trust/streamlining layer.

**tools**
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| chest_id | uuid, FK → profiles | owner — exactly one chest per tool |
| name | text | |
| category | text, nullable | **optional**, not required to list a tool. A lightweight browse/filter facet and icon picker only — taxonomy is intentionally unfinalized and does not drive search relevance (see Search Relevance below) |
| kind | enum: single / set | a "set" (e.g. screwdriver bit set) is one atomic listing — no sub-item tracking |
| description | text, nullable | free text. **No longer collected by the listing form** as of 0026 — replaced by condition/brand/subcategory, which are structured and searchable. Existing values are kept and still rendered on a tool's page | |
| photos | text[], max 3 | Supabase Storage paths — up to 3 per tool, shown as a swipeable gallery (dot indicator) on the tool detail screen |
| portable | bool | |
| supervised_required | bool, default false | **default** posture for any borrower who hasn't been individually authorized otherwise. Most common for stationary equipment, but no longer exclusive to it — any tool can carry this default |
| monetize | bool, default false | |
| price | numeric, nullable | |
| price_duration_unit | enum: hour / half_day / day / week / month, nullable | "hour" added after initial testing — short-duration rentals weren't covered |
| status | enum: available / requested / borrowed / unavailable_malfunction | the borrow *lifecycle*. Denormalized from `borrow_requests` and recomputed by `refresh_tool_state()`, never assigned ad hoc |
| paused | bool, default false | owner has withdrawn the listing — hidden from search and the map, but not deleted and its history is kept. Deliberately **not** a `status` enum value: pausing must not destroy the underlying lifecycle state (0023) |
| due_at | timestamptz, nullable | when the current loan is due back. A display cache, recomputed alongside `status` by the same helper; `borrow_requests.due_at` is authoritative (0024) |
| default_loan_days | integer, nullable, 1–365 | owner's usual lending period — pre-fills the borrower's request; falls back to 7 days if unset (0024) |
| subcategory | text, nullable | second level of the taxonomy — see Search Relevance (0026) |
| condition | text, nullable, one of new/good/fair | required by the listing form; nullable in the schema because every tool listed before 0026 has none and guessing would invent data about someone else's property |
| brand | text, nullable | optional; weighted as highly as `name` in search (0026) |
| for_sale | bool, default false | owner is open to selling outright. Independent of `monetize` — a tool can be rented, sold, both, or neither (0021) |
| asking_price | numeric, nullable | **not publicly granted** — same column-GRANT protection as `pickup_location`, readable only by the owner via `get_asking_price()`. A prospective buyer sees the `for_sale` flag and inquires by chat rather than seeing a number (0021) |
| pickup_location | text/geo | **never exposed by default read access** — see Security Considerations |
| created_at, updated_at | timestamptz | |

A tool's associated group(s) are **derived**, not stored: `tool → chest_id → group_memberships (status=approved) → groups`. This is why global search can deduplicate by tool while still listing every group it's associated with.

**favorites**
| field | type |
|---|---|
| id | uuid, PK |
| profile_id | uuid, FK → profiles |
| tool_id | uuid, FK → tools |
| created_at | timestamptz |

**borrow_requests**
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| tool_id | uuid, FK → tools | |
| borrower_id | uuid, FK → profiles | |
| lender_id | uuid, FK → profiles | denormalized from `tools.chest_id` for simpler RLS |
| status | enum: pending / approved / denied / completed / cancelled | |
| wants_instruction | bool, default false | borrower opted in to "I'd like a quick walkthrough on using this" — a convenience signal included in the notification to the owner, not a liability/attestation mechanism |
| auto_approved | bool, default false | |
| pickup_location_revealed_at | timestamptz, nullable | set the moment status → approved; this *is* the reveal mechanism |
| delegated_approver_id | uuid, FK → profiles, nullable | **placeholder only — no logic attached yet** (group-admin-facilitator idea, backlog) |
| requested_at, decided_at | timestamptz | |

Approving a request and revealing the pickup location are the same event — there is no separate "request address" step. This intentionally supersedes the original MVP's two-step (borrow request + address request) design.

**tool_malfunction_reports**
| field | type |
|---|---|
| id | uuid, PK |
| tool_id | FK → tools |
| reported_by | FK → profiles |
| note | text |
| created_at | timestamptz |
| resolved_at | timestamptz, nullable |

Inserting a report sets the parent tool's `status` to `unavailable_malfunction` (DB trigger or RPC). The owner must explicitly resolve it (clearing `resolved_at`, flipping status back) before the tool is requestable again.

**tool_authorizations** (standing state per tool + borrower pair — not tied to any single request)
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| tool_id | uuid, FK → tools | |
| borrower_id | uuid, FK → profiles | |
| supervision_required | bool | current requirement for **this borrower on this stationary tool** — whether the owner needs to be present when they use it. Initializes from `tools.supervised_required` on first contact, then persists |
| updated_by | uuid, FK → profiles, nullable | which owner last changed `supervision_required` |
| updated_at, created_at | timestamptz | |

This is purely an access-logistics record now, not a competency/liability attestation (that system was removed — see Non-Goals). An owner can personally trust a specific borrower to use a stationary tool unsupervised, independent of any formal "certification" — it's their own call, made explicitly, never automatic.

**events** (product analytics log — internal only, no third-party analytics vendor)
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| profile_id | uuid, FK → profiles, nullable | nullable to allow pre-auth events later if ever needed |
| event_type | text | e.g. `signup`, `profile_completed`, `tool_listed`, `search_performed`, `borrow_requested`, `borrow_approved`, `borrow_denied`, `group_joined`, `favorite_added` |
| metadata | jsonb, nullable | flexible per-event payload |
| created_at | timestamptz | |

**feedback**
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| profile_id | uuid, FK → profiles, nullable | |
| message | text | single free-text field — "Any improvements or suggestions?" |
| page_context | text, nullable | which screen/tab the user was on when they submitted |
| created_at | timestamptz | |

**notification_preferences** (1:1 with profiles)

*Tool activity — in-app + email together per toggle, tied to specific events:*
| field | type |
|---|---|
| profile_id | PK, FK → profiles |
| tool_availability | bool, default true |
| tool_status_change | bool, default true |
| tool_malfunctioning | bool, default true |
| borrower_reminders | bool, default true |
| meeting_reminders | bool, default true |

*Toolber updates — email-only, platform-level broadcast content, not tied to a specific event:*
| field | type | notes |
|---|---|---|
| functional | bool, default true | software updates, account matters |
| community | bool, default false | newsletters, webinars, tips — opt-in |
| marketing | bool, default false | offers, sponsor messages — opt-in |

**Not governed by this table at all:** genuinely critical security/account emails (password reset, suspicious login, etc.) always send via Supabase Auth directly — they're never toggleable, and shouldn't be confused with the `functional` preference above, which covers general update announcements, not security-critical transactional mail.

**conversations / conversation_messages** (0019 — general 1:1 messaging)

Any two verified users can message each other; a conversation is not scoped to a borrow request. `conversations` carries the unordered pair with a `unique (least(a,b), greatest(a,b))` index, and `start_conversation(other_user_id)` is a get-or-create that handles the race. This **superseded** 0013's request-scoped chat: the old `/requests/:id/chat` route still resolves, but only to look up the pair and redirect into the general conversation, so no old link breaks.

**user_reports** (0015 — report a user to the platform admins)

Reporter, reported user, optional request/tool context, free-text reason. Reachable from a tool's owner dropdown, from either side of a borrow request, and from a conversation.

**notifications** (in-app feed, Realtime-subscribed)
| field | type |
|---|---|
| id | uuid, PK |
| profile_id | recipient |
| type | matches the categories above |
| payload | jsonb |
| read_at | timestamptz, nullable |
| created_at | timestamptz |

### Search Relevance
Search ranking is driven by Postgres full-text search, not by category matching:

1. A generated `tsvector` column on `tools` combines **name** and **brand** (weight A), **subcategory** and **description** (weight B), and **category** (weight C). Rebuilt in 0026 to fold in the structured fields that replaced free-text description — a generated column's expression cannot be altered in place, so it and its index are dropped and recreated
2. A GIN index on that column keeps lookups fast at any scale this app will realistically reach
3. Queries run through `websearch_to_tsquery` (handles natural typed queries, stemming — "wrenches" matches "wrench") and rank with `ts_rank_cd`, which specifically rewards results where **more of the query's terms are present and where they appear close together**
4. This gives the exact behavior wanted without any hand-rolled scoring: searching "oil filter wrench" ranks a tool named "Oil filter wrench" above one named "18-piece socket wrench set," because the first matches all three terms densely and the second matches only one
5. Category is deliberately weighted low in *ranking* (it is required on the form as of 0026, but a tool having one barely moves its search position) — it's a nice-to-have filter facet and icon-selection hint, not a search dependency. If the category taxonomy is revised or a tool has no category, search quality is unaffected.
6. Future, not now: `pg_trgm` trigram matching for typo-tolerance (e.g. "oil filtr wrench" still finding the right tool) — a cheap addition later, not a day-one requirement

**Category's UI placement (designed, not built):** not a permanent pill row. Note this section predates 0026, which made category **required** on the listing form — the reasoning below about it being optional and non-blocking no longer holds for *listing*, though it still holds for *filtering*, which is what this paragraph is actually about. It lives inside a **Filters sheet**, opened via a filter icon next to the search bar, alongside the other optional facets: free/monetized, portable/stationary, availability status, favorites-only, group. If the taxonomy proves genuinely useful for quick browsing later, promoting it to always-visible pills is a cheap follow-up — not a day-one commitment.

**The taxonomy is real and final.** It lives in `Tool Categories/garage_tool_categories.csv` — 37 top-level categories and ~388 subcategories — and `src/lib/toolCategories.js` is *generated* from that file, so regenerate rather than hand-editing. Category became **required** on the listing form in 0026, and both levels are stored (`tools.category` + `tools.subcategory`) and both feed the search vector, so "Automotive" and "Brake & suspension service" each find the same tool.

**Built:** `CategoryCombobox` is the searchable picker this section describes — type any part of either level, every term must match (AND, not OR), "Other" always available as a catch-all. **Not built:** the Filters sheet it was meant to live in. It currently sits inline on the listing form, and search itself is a single text box plus a Browse/Map View toggle, with no facet filtering at all.

**Category filter is multi-select, matched as OR — designed, not built.** A tool only ever carries one `category` value itself, but the filter lets a user select several at once (e.g. Power + Garden) — a tool matches if its category is *any* of the selected values, not all of them. Implementation: `WHERE category = ANY($selected_categories)`, combined with (not replacing) the full-text relevance ranking on the typed query.

### Location & Privacy Model
Search results are plotted using **each chest's own persisted `approx_lat/lng`** — never the tool's real `pickup_location`, and never a shared group-wide point. This matters for two distinct reasons:

1. **Stacking:** if many chests in the same group/ZIP all resolved to one shared reference point (e.g. the group's own `approx_lat/lng`), every one of their pins would render on top of each other. Each chest needs its own distinct approximate point.
2. **The averaging attack:** fuzzy-location systems that re-randomize a point on every request are actually *less* private than a fixed fuzzy point — repeated samples around the same true location average out the noise and reveal it almost exactly (a known failure mode in other apps that fuzzed location naively). The fix is that a chest's `approx_lat/lng` is generated **once** and persisted; it is never regenerated on view, per session, or per group. It only changes when the owner explicitly updates their true location or radius — a "shuffle/reroll" control must not exist, since repeatedly rerolling the same true point + radius reintroduces the same averaging vulnerability over time.

**Generation (`pin_placement_mode = auto_jitter`):**
1. Take the chest's private `home_lat/home_lng`
2. Generate a uniformly random point within a disc of radius `pin_radius_meters` around it — radius must be scaled by `√(random)`, not `random` directly, or points bunch up near the center instead of spreading evenly across the disc
3. Snap that point to the nearest real street/intersection via Mapbox's Tilequery API, so the pin reads as a plausible address rather than floating in a backyard, a lake, or an empty lot
4. Store the result in `approx_lat/lng`; this is the only value ever served to other users

**Generation (`pin_placement_mode = manual`):** the owner (for their chest) or a group admin (for the group's own reference point) drags a pin to a location of their choosing — no jittering or snapping applied, since it's already a deliberate human choice. No radius is stored in this mode.

**Required at profile setup, no silent fallback:** a chest cannot list tools until it has made an explicit location choice — either `approx_lat/lng` via one of the two modes above, **or** `map_pin_hidden = true` (opting out of the map entirely, still findable via list search). There is intentionally no app-wide default radius; leaving it unset simply blocks listing until the owner makes one of those two explicit choices.

**Group's own `approx_lat/lng`** is a separate, admin-settable general reference point, and is now **also rendered as its own pin** on the search map (distinct blue, slightly-larger teardrop marker vs. red-orange chest pins) — it is never what an individual tool's pin is plotted at, it's just visible in its own right.

**Opting out entirely:** an owner can set `profiles.map_pin_hidden = true` to omit their chest from the map altogether. Their tools remain findable through the textual list view; they just never render as a pin. This is independent of `pin_placement_mode`/`pin_radius_meters` — hidden chests don't need a valid `approx_lat/lng` at all beyond whatever was already set.

### API Design / Key Interfaces
Supabase's auto-generated REST/client-SDK access covers straightforward CRUD (list tools, read profile, toggle notification preferences, manage favorites) under RLS. **Every RPC below is `REVOKE EXECUTE ... FROM public` + `GRANT ... TO authenticated`** — Postgres grants EXECUTE to PUBLIC by default, which left all of them callable by `anon` until 0014 (SEC-3). A handful of Postgres RPC functions (`SECURITY DEFINER` where needed) handle logic that must be trusted server-side:

- `request_borrow(tool_id, wants_instruction?, days?)` — checks "vetted" auto-approve eligibility, refuses a paused or unavailable tool, dedupes against an existing pending request, creates the `borrow_requests` row, fires a notification (+ email) to the lender
- `approve_borrow_request(request_id, days?)` / `deny_borrow_request(request_id, reason?)` — lender-only; approve sets `pickup_location_revealed_at = now()` and the agreed `due_at`; fires notification (+ email) to the borrower
- `complete_borrow_request(request_id)` — either party marks the tool returned. This is what ends the pickup-location reveal (0014, LOGIC-1)
- `refresh_tool_state(tool_id)` — **internal, not client-callable.** Recomputes `tools.status` and `tools.due_at` from `borrow_requests`; every RPC above delegates to it rather than assigning status ad hoc. Its CASE branches need explicit `::tool_status` casts — an untyped CASE resolves to `text` and Postgres refuses the assignment (0027; the same bug 0017 fixed elsewhere)
- `delete_tool(tool_id)` — owner-only; refuses while the tool is out on an approved loan, notifies anyone with a pending request (the notification carries the tool *name*, since the row is about to stop existing), and returns the photo paths so Storage can be cleaned up (0023/0024)
- `get_asking_price(tool_id)` — owner-only read of the non-public `asking_price` column (0021)
- `send_overdue_reminders()` — **internal, scheduled.** Daily pg_cron sweep; notifies both parties about a loan past its `due_at`, repeating every 3 days (0025)
- `start_conversation(other_user_id)` — get-or-create for a 1:1 conversation (0019)
- `request_to_join_group(group_id)` / `decide_group_membership(membership_id, approve)` / `remove_group_member(membership_id)` — the no-invite-code join path, the admin decision, and admin removal
- `get_group_invite_details(group_id)` — approved-members-only read of `invite_code` and `default_exchange_location`, which are column-REVOKEd like `pickup_location` (0014, SEC-2)
- `get_my_contact_info()` / `get_borrow_contact(request_id)` — contact details revealed to the counterparty once a request is approved (0007)
- `get_pickup_location(tool_id)` — returns the pickup location **only** if the caller has an approved `borrow_requests` row for that tool; this is the only path to that data
- `report_malfunction(tool_id, note)` — inserts the report, flips tool status, notifies the owner
- `set_borrower_supervision(tool_id, borrower_id, supervision_required)` — owner-only; updates (or creates) the `tool_authorizations` row, recording `updated_by`/`updated_at`. This is the only way `supervision_required` ever changes — never automatic, never borrower-initiated
- `join_group(invite_code)` — creates a pending `group_memberships` row; admin approval flips it to approved. Only notifies when a row was actually created, so it can't be looped to flood an admin (0014, SEC-3)
- Edge Function `notify` — triggered on `notifications` insert; checks the recipient's `notification_preferences`, and if enabled, calls Resend to send the email

### Navigation
Five-tab bottom nav: **Search** (global search + map, list/map toggle), **My Tools** (renamed from "My Chest"), **Groups**, **Favorites**, and **Settings** (gear icon — not "Profile"). A floating feedback button sits outside the nav, reachable from anywhere.

- **My Tools** covers your tool inventory (listing management, borrower authorizations) *and* a **Requests** sub-section — incoming/outgoing borrow requests, malfunction alerts, meeting reminders. Requests is no longer a separate top-level tab; it's a subject/sub-view within My Tools.
- **Groups** has two entry points: **Create New** and **Find a Group** (proximity-sorted discovery, searchable by name/zip/city/neighborhood/tools offered — see Find/join a group flow), plus a **My Groups** list. A group you've requested to join but haven't been approved or denied for shows a **"Request Pending"** badge in that list — same underlying `group_memberships.status = pending` state as before, just surfaced with that literal label.
- **Settings** is the single hub for: profile info (bio, profile photo), notification preferences, privacy (map pin radius/manual placement/hidden — see Location & Privacy Model), proximity settings, and a payment settings section reserved for the monetization phase (stubbed/disabled until then).

**No user-selectable app look/feel.** Only light/dark/system mode is user-configurable (see `theme_preference`) — there is no accent-color picker or alternate visual-identity option. One design direction gets built and maintained; offering multiple skins was considered and explicitly rejected as an ongoing maintenance/consistency cost not worth paying.

### Key Flows

**List a tool**
1. User must have `profile_complete = true` and `tos_accepted_at` set (agree to Terms/Privacy) before listing is allowed
2. Fill in name, category, description, photo(s), portable/stationary, monetize (+ price/duration if so), kind (single/set)
3. Tool is created with `status = available`; its group visibility is whatever the owner's chest is already a member of — nothing to pick per-tool

**Search**
1. Any authenticated user with a completed, email-confirmed profile can search globally by keyword or tool type
2. Results are deduplicated by tool; each result shows the tool, its associated group(s), and a map pin at the **owning chest's own `approx_lat/lng`** — unless that chest has opted out of map display (`profiles.map_pin_hidden`), in which case it still appears in the textual list view, just with no pin
3. **Groups are also pinned** on the same map, at their own `approx_lat/lng`, as a distinct marker layer — helps someone evaluate which group to join, independent of any specific tool search
4. Pin styling: both are teardrop-shaped map markers. **Tool pins: red-orange, standard size. Group pins: blue, slightly larger** — visually distinct at a glance. Each pin's always-visible label is the **tool's own name** (group pins: the group name); its popup leads with the tool's first photo as a thumbnail plus a two-line description clip.

   > **The owner's display name appears on neither the label nor the popup** — deliberately. It used to be the label, on the reasoning that a pin represented a person rather than any one tool. But a pin is per-tool (see the plotting note above), so the owner's name was never needed to disambiguate it, and putting an identity on the always-visible map layer is strictly more exposure than putting it one click deeper. Identity now surfaces only on Tool Detail, where someone has actively opened a specific listing.
   >
   > This does **not** claim to hide who owns what: search results in list view still show the owner's display name on every card, so an owner's inventory remains assemblable by anyone who wants to. Anti-targeting rests on the location fuzzing, the approval gate, and the 30-day reveal expiry — not on pin labelling. Note also that per-tool pins fan out into a visible ~30 m ring around one chest's shared point, which *reveals* roughly how many tools that chest holds; that is an accepted trade for search usability.
5. Clicking a pin or a list row shows lender name/photo, associated group(s), and short description — never the pickup location or the group's exact reference point beyond its own approximate pin
6. Search input placeholder/example copy is comma-separated, no quotation marks, prefixed "Comma separated — " rather than "Search — " (e.g. "Comma separated — ladder, drill bits, paint sprayer…") — a small copy convention, but consistent across the app
7. **Only pins matching the current search/filter are shown on the map** — the map is not pre-populated with every pin by default; typing a query narrows both the list and the map to matching results together
8. The results list beneath the map **scrolls independently** — the header and map stay in place while the list scrolls underneath

**Request to borrow**
1. Borrower taps "Request to borrow." An optional checkbox is offered on every request, framed as a convenience, not a liability mechanism: "I'd like a quick walkthrough on using this tool." Checking it sets `wants_instruction = true` and is surfaced to the owner in the request notification — nothing else changes based on it
2. If the tool is `supervised_required` (a stationary tool the owner hasn't personally exempted this borrower from), the client checks `tool_authorizations` for this (tool, borrower) pair — a first-time borrower defaults to the tool's own setting; a borrower the owner has previously exempted (`supervision_required = false`) skips it. This is purely about whether the owner needs to be present for a stationary tool, not a competency check.
3. `request_borrow()` runs — if the borrower is "vetted" (shares an approved group with the lender, or has a payment method on file once that's active) **and** the lender has `auto_approve_vetted_borrowers = true`, the request auto-approves immediately
4. Otherwise it's `pending`; the lender gets an in-app + email notification (including the walkthrough request, if any) and approves/denies manually
5. On approval (auto or manual): `pickup_location_revealed_at` is set, tool status → `borrowed`, borrower is notified and can now call `get_pickup_location()`. If the location is a residence, the UI shows a standard privacy/risk disclosure alongside it
6. Separately, at any time, an owner can visit a stationary tool's authorization list and flip a specific borrower's `supervision_required` to `false` — their own personal call, never automatic, never tied to any formal certification (there isn't one)

**Find/join a group**
1. **Discovery, not just code entry**: a "Find a Group" screen lists nearby groups sorted by proximity — distance from the user's own chest `approx_lat/lng` to each group's `approx_lat/lng`. No new sensitive data needed; reuses what's already computed for map pins. An invite-code entry field remains available as an alternate path for groups that aren't openly discoverable.
   - Search spans **name, zip code, city, neighborhood label, and tools offered by the group's members** — not just the group's own name. Zip/city/neighborhood match against the new structured `groups.city`/`groups.zip_code` fields (plus `neighborhood_label`); tools-offered means matching a typed query against the aggregate of every member chest's tool `tsvector` within that group, not a field on `groups` itself — implemented as a query joining `groups → group_memberships (approved) → tools`, ranked the same way as tool search (see Search Relevance), rather than a separately maintained denormalized column. Each result card shows a short "Offers: …" preview of matching/representative tools so this is a visible attribute, not just a hidden search dimension.
   - Status pill copy: **"Request Pending"**, not bare "Pending" — applies consistently to both a pending group-join request and a pending borrow request, anywhere that status is shown.
2. User taps "Request to Join" (from discovery) or enters a code → pending `group_memberships` row created; the list item shows a "Pending" status pill in place of the action while awaiting a decision
3. Group admin approves/denies from their admin inbox — surfaced on the Groups screen as an orange attention-dot on that group's card (see notification dot color convention)
4. Approval doesn't retroactively change anything about tools already in-flight — it only affects future "vetted" eligibility and default-location convenience

**Group detail**
Tapping a group (from My Groups or Find a Group) opens a group detail view: the group's own info (admin, member count, default exchange location) plus a filtered view of Search scoped to just that group's tools — i.e., tools whose owning chest is an approved member of this group.

**Create a group**
Admin sets: name, neighborhood label, city, zip code, and optionally a default exchange spot (see below). Invite code is generated automatically, never typed by the admin.

**Setting the default exchange spot**
One shared screen/flow handles this for both group creation and later edits — search by address/landmark, or tap a map to drop a pin directly. Unlike a chest's `approx_lat/lng`, this location is **deliberately precise, not privacy-fuzzed** — the entire point is a real, findable meeting spot. On Group Detail, this field is editable only by the group's admin (a small pencil icon marks it as such); regular members see it read-only. It remains a convenience default only — an individual tool's own pickup location can still differ per the Unified rule in Location & Privacy Model.

**Analytics & feedback**
1. Meaningful product actions (signup, tool listed, search performed, borrow requested/approved/denied, group joined, favorite added, etc.) write a row to `events` as a side effect — not a separate step the user takes
2. An always-visible floating "Feedback" button, reachable from anywhere in the app, opens a single-field prompt ("Any improvements or suggestions?") — submitting writes to `feedback` along with the current page/tab as `page_context`
3. A route restricted to `profiles.is_platform_admin = true` (you) shows a simple internal dashboard reading `events` and `feedback` — counts/trends over time, funnel drop-off between key steps, and a raw feed of submitted feedback. No third-party analytics vendor involved; everything lives in the same Supabase project

**Report a malfunction**
1. Any user with an approved borrow history (or the owner) can file a report with a note
2. Tool immediately flips to `unavailable_malfunction`
3. Owner is notified, must resolve before the tool is requestable again

### Tech Stack
- **Frontend:** React + Vite, Tailwind. **No icon library** — `lucide-react` was dropped as an unused dependency; icons are hand-written inline SVG (see CLAUDE.md → Coding Standards). The visual direction is "Motorsport", a rebuild rather than a port of `toolber.jsx`
- **Backend:** Supabase (Postgres, Auth, Storage, Realtime, Edge Functions)
- **Map:** Mapbox GL JS
- **Email:** Resend, called from a Supabase Edge Function
- **Bot protection:** Cloudflare Turnstile on signup *and* login — Supabase's Bot and Abuse Protection gates every auth endpoint once enabled, not just `signUp`
- **Hosting:** a Cloudflare Worker (static assets) at **https://toolber.org**, deployed from `https://github.com/Platow-Apps/Toolber`
- **PWA:** Web app manifest + service worker (offline app shell at minimum)

### Security Considerations
- **Pickup location and chest home coordinates are the most sensitive fields in the schema.** `tools.pickup_location` and `profiles.home_lat/home_lng` must never be returned by a general `SELECT *` under RLS — Postgres RLS is row-level, not column-level, so the pattern as built is: (a) `REVOKE SELECT ON tools` followed by an explicit column-level `GRANT SELECT (…)` that omits the protected column — a **column GRANT, not a view** — and (b) the `get_pickup_location()` `SECURITY DEFINER` RPC as the *only* path to it, gated on an approved `borrow_requests` row that is **less than 30 days old**. The same shape now protects `tools.asking_price` and `groups.invite_code`. `scripts/test-no-direct-pickup-location.sh` fails the build if any file in `src/` reads one of these columns directly. Get this wrong and the app's core privacy promise breaks.
- Auth handled entirely by Supabase Auth (bcrypt password hashing, session tokens) — no custom credential handling
- Listing a tool (and borrowing) requires ToS/Privacy acceptance on file (`tos_accepted_at`). The ToS is where risk acknowledgment actually lives now: borrowers acknowledge inherent risk in using a borrowed tool; lenders acknowledge responsibility/risk exposure if their tool is misused. One-time acceptance, not a per-borrow attestation. The actual legal documents still need attorney review (see Open Questions).
- Malfunction auto-flip protects future borrowers by default; can't be bypassed by the reporter
- Rate-limit `request_borrow` / `join_group` at the Edge Function or RLS-policy level to deter spam/abuse
- **Not covered here — explicitly a non-engineering gap:** liability if someone is injured with a borrowed tool, and the legal soundness of storing/sharing home addresses at all. These need a real attorney, not this document.

### Testing Strategy
- **Schema/RLS:** pgTAP, in `supabase/tests/` — run with `supabase test db`, which needs Docker and so is deliberately not part of `test:all`. This is the *only* layer that can test an RLS policy or a column grant, since the AVA suite mocks Supabase entirely — specifically, tests proving `pickup_location` is unreachable except through an approved `borrow_requests` row
- **RPC functions:** unit-test each function's edge cases (non-vetted requester, malfunction on an already-unavailable tool, a borrower attempting to bypass a stationary tool's supervision requirement)
- **Frontend:** component tests with **AVA** + React Testing Library (not Vitest — see CLAUDE.md → Testing for why `workerThreads` is off). ~358 tests, run by `npm run test:all` alongside lint, types, knip, semgrep and `npm audit`
- **Manual QA:** walk the "Core loop" section of `docs/feature-checklist.md` end-to-end before each milestone

### Migration / Rollout Plan — ✅ complete

**Historical.** This plan is done; the app is built, deployed and in use at
https://toolber.org. Kept for the record of what order things were built in.
The original prototype is frozen at `docs/prototype/` and is reference only.
Steps 1–10 all shipped:

1. **Scaffold** a real Vite + React + Tailwind project; port `toolber.jsx`'s components in as the starting UI
2. **Auth + profiles** — Supabase Auth, profile-completion gate, ToS acceptance
3. **Core schema** — tools, chests(=profiles), favorites; replace `SEED_TOOLS` with live Supabase queries
4. **Groups** — group creation/join/approval, admin inbox
5. **Borrow flow** — `request_borrow`/`approve`/`deny` RPCs, pickup-location reveal, the optional walkthrough-request checkbox, malfunction reporting
6. **Notifications** — in-app Realtime feed + preference toggles + Resend email via Edge Function
7. **Search & map** — global search, Mapbox integration, dedupe-by-tool logic
8. **PWA** — manifest, service worker, installability
9. **Analytics & feedback** — `events` logging on key actions, floating feedback button, internal admin-only dashboard
10. **Deploy** — push to `Platow-Apps/Toolber`, served by a Cloudflare Worker (static assets), custom domain `toolber.org`
11. **Backlog, in no particular order:** drop-off location field, delegated-approver logic, AI photo tool-ID, payments/Stripe Connect, native app wrapping, push notifications, ratings/disputes

**Built since, beyond the original plan:** photo upload with client-side
downscaling and stored thumbnails; general 1:1 messaging; listing management
(edit / pause / guarded delete); loan durations, due dates and overdue
reminders; sell-alongside-rent with a private asking price; report-a-user;
Turnstile bot protection and an 18+ gate; the real category taxonomy; and the
`toolber.org` custom domain.

### Open Questions
- Real Terms of Service / Privacy Policy / Release of Liability — still placeholder text. Needs attorney review before this is offered to people outside the immediate test group
- Drop-off location field shape, once picked up (flagged in the checklist as "planned, not this pass")
- The Filters sheet described under Search Relevance is designed but not built; search is currently a single text box plus a Browse/Map toggle
- `delegated_approver_id` on `borrow_requests` remains a placeholder column with no logic attached
- The pgTAP suite has never been executed — it needs Docker, which the current dev machine does not have. It is written and committed, but unverified
