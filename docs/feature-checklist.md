# Toolber — Feature Checklist (living document)

This file is the running source of truth for what Toolber does and doesn't do. We add to it and cross things off as we make decisions during discovery and build. It fed into `docs/technical-design.md`, `CLAUDE.md`, and `docs/architecture.md` (generated 2026-08-13) — but it stays live: keep updating it as scope changes, and revisit those three docs when a change here is significant enough to warrant it.

**Legend:** `[x]` decided/committed · `[ ]` open / not yet decided · `[~]` deferred / backlog (explicitly future, not this cycle)

## Stack & infra decisions
- [x] Free peer-to-peer tool borrowing at launch — no money changes hands
- [x] Ship as an installable **PWA** (native App Store/Play Store wrapping via Capacitor is a **later phase**)
- [x] Backend platform: **Supabase** (Postgres DB + Auth + File Storage + Realtime)
- [x] Auth method: **email + password** (Supabase Auth) — no magic link, no SMS OTP, no social login for now
- [x] Groups stay **invite-code + manual admin approval only** — no geo-verification of addresses against neighborhood boundaries
- [x] Notifications: **in-app (Supabase Realtime) + email + web push**, toggleable by category *and* by channel (see Notifications below). Web push shipped ahead of the native wrapper — the Web Push API covers it on Android and on installed iOS PWAs, so the native phase is no longer what gates it.
- [x] Tool photos stored in **Supabase Storage**
- [x] Frontend PWA hosting: **Cloudflare Pages**, deployed from GitHub
- [x] GitHub repo: https://github.com/Platow-Apps/Toolber.git (already exists)
- [x] Transactional email provider: **Resend**
- [x] Map provider: **Mapbox** — new dependency, used for approximate group/tool location on search results
- [~] Paid rentals with a 10% Toolber platform fee (Stripe Connect or similar) — deferred

## Core loop (build first)
- [ ] Sign up / log in (email + password)
- [ ] Create/join a group via invite code + admin approval
- [ ] List a tool
- [ ] Search tools **globally** (all groups, not just yours) by keyword or tool type
- [ ] Search results show the tool's group on a **Mapbox map**, approximate location only
- [ ] Request to borrow → owner approves/denies
- [ ] Request address reveal → owner approves/denies
- [ ] Notifications (in-app + email) for the above events, toggleable by category
- [ ] Installable PWA (manifest + service worker, offline app shell)
- [ ] Favorite a tool / view a favorites list

## Expanded scope (added this round — Friday deadline dropped, prioritizing usability)

**Notification categories (user-toggleable)**
- [ ] Tool availability (a favorited/watched tool becomes available)
- [ ] Tool status change
- [ ] Tool malfunctioning (see Malfunction reporting below)
- [ ] User & borrower reminders
- [ ] Meeting reminders (owner/borrower have to physically meet to hand off the tool)

**Tool sets/bundles**
- [x] A set of tools (e.g. screwdriver bit set) can be listed and borrowed as a **single atomic listing** — one status for the whole set, no individual-piece tracking (decided over the more complex per-item-tracking alternative)

**Stationary & supervised tools**
- [x] Tools can be marked **portable** or **stationary**
- [x] Stationary tools get an owner toggle: **supervised** or **unsupervised** access
- [x] "Supervised" means **manual coordination** — owner and borrower message/arrange a time themselves once the request is approved. No scheduling/calendar engine being built for this.

**Malfunction reporting**
- [x] Reporting a tool malfunctioning **automatically flips its status to unavailable/under repair**; owner must actively clear the flag before it's requestable again

**AI tool-name suggestion from photo**
- [~] Backlog — noted as a planned enhancement, **not built this cycle**. When picked up: suggest a tool name from an uploaded photo via a vision-capable AI API.

**Pricing**
- [ ] Monetized listings get a price **and a selectable duration unit**: half-day, day, week, or month (expands MVP's flat $/day model)

**Profile & tool chest**
- [x] Personal profile per user, connected to a personal **"tool chest"** (their tool inventory — adopted as the app's term for "My Tools")
- [x] Each **tool (or tool set) belongs to exactly one chest** — a single owner, no shared/multi-owner tools
- [x] Each **chest can belong to multiple groups** (many-to-many, via approved membership) — a tool's group affiliation is **derived from its chest's group memberships**, not set per-tool individually
- [x] Global search **deduplicates by tool** — a tool whose chest is in 5 groups still appears once in results/on the map, showing all its associated groups underneath
- [x] Clicking a map pin, or selecting a tool from the textual list-view sidebar, shows: lender's profile name + photo, the group(s) the tool belongs to, and a short description
- [x] Any authenticated user with a **completed profile + confirmed email** can search tools globally — no group membership required to search
- [x] Any authenticated user who **agrees to Terms/Privacy** can list tools in their chest — no group membership required to list
- [x] Groups may optionally designate a **default exchange/meet-up location**
- [x] Borrowing is **always owner-approved by default** — owner gets a notification and approves/denies via a checkbox-style confirmation. No fully self-service checkout.
- [x] Lenders can optionally enable **auto-approve for "vetted" borrowers** — defined as: the borrower shares an approved group membership with the lender's chest. Requests from outside any shared group are never auto-approved.
- [x] Ungrouped lenders' tools remain borrowable via direct request → owner approve/deny (independent of any group)
- [x] ~~Tools flagged "requires certification" with a mandatory competency checkbox~~ — **removed, see "Certification — reconsidered and removed" below**
- [x] "Vetted" (for auto-approve eligibility) = **shares a group with the lender OR has a payment method on file** (the credit-card clause only becomes active once monetization/Stripe ships — deferred, but the definition is locked in now for forward compatibility)
- [x] Precise/exact location is revealed to a group member **only after their specific borrow request is approved** — not just by virtue of group membership. (Refines the earlier draft: membership alone does not unlock location.)
- [x] Design principle driving several of the above: **trust is graduated, not absolute** — group membership improves the default posture (eligible for auto-approve) but every actual disclosure (location) stays owner-controlled per listing/request. Groups streamline; they don't remove the owner's final say. ("Some borrowers, even though they belong to a group, can be shady.")

**Dynamic/mobile tool location**
- [x] Tools aren't always at a fixed spot (e.g. at a worksite) — the lender can update a tool's **"pickup location"** at any time (renamed from "current location")
- [x] No separate "home address vs. exchange point" mode — it's always just **one pickup location**, which the lender chooses (may well be their residence, or may be somewhere else entirely — their call)
- [~] **"Drop-off location" field — planned for later, not this pass.** When added: separate field from pickup location, with a "same as pickup location" option so it's a one-click default in the common case where the tool goes back to the same spot.
- [x] If the pickup location is a residence, the borrower sees a **standard risk/privacy disclosure** when it's revealed to them
- [x] **Unified rule:** ALL borrow requests — group or ungrouped — require owner approval, no exceptions, and the pickup location is revealed only **after** that specific request is approved. Same mechanic everywhere, no group/non-group branching.
- [x] Group's optional default exchange location still stands as a **convenience suggestion**, not a requirement — any individual tool's pickup location can differ from it

**Group admin as facilitator (brainstormed, not yet specified — backlog exploration)**
- [x] Reserve a placeholder **`delegated_approver` field on the borrow-request table now** (unused, no logic attached) so it's not a schema retrofit later. Actual delegation feature/logic is still fully deferred — not defined yet, not built now.

**Legal**
- [ ] Release of Liability, Terms of Service, Privacy Policy — Claude can draft first-pass placeholder language, but this needs real attorney review before real use; not legal advice
- [x] **ToS carries the risk acknowledgment, not a per-borrow checkbox**: borrowers acknowledge inherent risk in using a borrowed tool; lenders acknowledge responsibility/risk exposure if their tool is misused. Accepted once, not re-litigated per borrow.

## Open / flagged, not resolved (not engineering decisions — noted, not blocking)
- [ ] Liability if someone is injured with a borrowed tool
- [ ] Privacy posture on storing/sharing real home addresses before legal review
- Assumption in force until told otherwise: launch audience = **you + trusted testers**, not a public launch to strangers
- Timeline is a **self-imposed pace target**, not tied to an external event/demo — no hard deadline

## Visual design
- [x] **Light/dark mode + "use system setting"** — a real requirement, token-based so both modes fall out of one design system automatically
- [x] **Not** offering users a choice between multiple full design directions (Motorsport/Pegboard/Index/Neighborhood-style skins) at runtime — that's N designs × 2 modes to maintain forever and dilutes a consistent visual identity. One direction gets chosen and built properly.
- [x] **Decided against:** no accent-color picker either — no user-selectable look/feel at all beyond light/dark/system. One design direction, fully realized.
- [x] **Chosen direction: Motorsport toolbox** — asphalt/safety-orange, condensed uppercase, angular clipped cards. Listings background is a **brushed-aluminum tool-drawer front** (seam lines, recessed handle pull) — explored and rejected a pegboard-texture alternative (both an "original flat" and a "realistic powder-coated" version) in favor of keeping this direction visually distinct from the Pegboard-earthy direction. See `toolber-directions.html` and `toolber-motorsport-bg-compare.html` mockups.
- [x] **Tagline, next to the wordmark, no dash**: cycles once through 11 phrases (6s each) — "Why buy? Borrow.", "Neighborhood tool lending app", "Put your tools to work.", "Lawn & Garden", "Power Tools", "Automotive", "Carpentry", "Industrial", "Fasteners & adhesives", "Saving $$ for thousands", "Contribute to your community" — then fades away for good, not a continuous loop. Respects reduced-motion. **Built for real** in `src/components/SearchTagline.jsx`, live on Search's header via `BrandBar`'s optional middle slot — an earlier, non-spec-matching 3-phrase version had drifted onto the Login/Signup `AuthHero` mid-session; that's been removed. Center-aligned (not right-aligned) and gray (`steelLight`, not wordmark-matching) per later revision — the one exception is "Lawn & Garden," which stays green to match its flower icon.
- [x] Search placeholder: just the comma-separated examples, no prefix at all — "ladder, drill bits, chain saw…"
- [x] Small icon appears between title and tagline, synced to the rotation, only for 4 of the 11 phrases: gray tire (Automotive), green flower (Lawn & Garden), light-brown hammer (Carpentry), yellow drill (Power Tools). No icon for "Industrial" or "Fasteners & adhesives" (same as Industrial, no spec given) or the marketing-only phrases.
- [x] **Category made optional** — not required to list a tool, taxonomy explicitly not finalized (original 9 categories were just initial suggestions, not locked in), category no longer drives search relevance
- [x] **Search relevance via Postgres full-text search** (`tsvector` on name/description/category, weighted, ranked with `ts_rank_cd`) — a query like "oil filter wrench" naturally ranks a tool matching all three terms above one just matching "wrench," with no hand-rolled scoring needed
- [x] Taglines confirmed as **pure marketing copy**, not a signal to revise the category taxonomy — the "Automotive/Carpentry/Industrial" question from before is moot given categories are non-blocking and unfinalized anyway
- [x] **Category filter lives in a Filters sheet** (opened via a filter icon next to the search bar), alongside other optional facets (free/monetized, portable/stationary, availability, favorites-only, group) — not a permanent pill row, to avoid overstating an unfinalized, non-blocking taxonomy
- [x] **Category picker is a searchable combobox**, not a chip list — expected to have too many categories to show all at once. Selected = removable chips above a search box; typing filters a dropdown; **"Other" always available** as a catch-all.
- [x] **Category filter is multi-select, OR-matched** — a tool matches if its (single) category is any one of the selected categories, not all of them
- [ ] **Waiting on the user for the actual category list** to populate the dropdown — current placeholders (Power, Hand, Yard, Ladder, Paint, Garden, Electrical, Measure, Cutting) are provisional only
- [x] Tool detail CTA button copy: **"Request Borrow"** (not "Request to borrow")
- [x] **Notification dot color convention**: orange = something awaiting your attention (pending request, inquiry — neutral/positive), red = an actual problem (malfunction alert). Plain solid dots, no digit inside, not hanging off the card corner.
- [x] **Group discovery by proximity** — "Find a Group" screen lists nearby groups sorted by distance (chest approx location → group approx location), with "Request to Join" per result. Invite-code entry stays available as an alternate path, not the only one.
- [x] **Group search spans name, zip code, city, neighborhood, and tools offered** by the group's members — not just the group's own metadata. Each result shows an "Offers: …" preview line. Added structured `groups.city`/`groups.zip_code` fields (distinct from the existing free-text `neighborhood_label`) to support this. Backend implication: joins across member chests' tools, ranked like tool search, not a field stored on `groups`.
- [x] **Status pill copy: "Request Pending"**, not bare "Pending" — applied consistently across group-join and borrow-request pending states
- [x] **Tapping a group shows its tools** — group detail = group info + a Search-like view filtered to that group's member tools. Now mocked (`toolber-group-detail.html`).
- [x] **Create New Group and default-exchange-spot editing designed** — `toolber-create-group.html` (name/neighborhood/city/zip/optional exchange spot, auto-generated invite code) and `toolber-set-exchange-location.html` (shared picker: address search or tap-to-place pin, deliberately precise/not fuzzed, unlike chest pins). Group Detail's exchange spot field now shows a pencil icon marking it admin-editable.
- [x] Group Detail, Notifications settings, and Privacy & Location settings screens designed — all sub-screens (back-button nav, no bottom tab bar, matching Tool Detail's pattern)
- [x] Favorites screen designed — reuses the existing tool-card pattern, no new components needed
- [x] **List a Tool screen designed** (`toolber-list-a-tool.html`) — photos, name, optional category (reuses Filters combobox), description, Single/Set, Portable/Stationary with conditional supervision toggle, required private pickup-location picker, monetize toggle
- [x] Monetize toggle subtitle links to **"Rental Terms"** instead of hardcoding the 10% fee in the UI — keeps the fee editable via a terms doc rather than baked into copy
- [x] **All core screens now designed**: Search, Tool Detail, Filters sheet, My Tools, Groups, Find a Group, Group Detail, Notifications, Privacy & Location, Settings, Favorites, List a Tool, Create New Group, Set Exchange Location
- [x] **3 new notification categories added**: Functional (default on), Community (default off), Marketing (default off) — grouped under "Toolber updates," email-only, distinct from the original 5 tool-activity categories (in-app + email together). Critical security/account emails bypass this system entirely, always sent via Supabase Auth.
- [x] **UI label "Random Pin"** for the auto-jitter placement mode (technical term stays as the internal enum value only) — reads better to users. Radius slider relabeled "Random pin proximity."
- [x] **"Chest" avoided in user-facing copy** — too much internal jargon, most people won't know what it means. "Set up your chest" → "Set up your account", "Hide my chest from the map" → "Hide my tools' location". The `chest_id` column/schema name stays as-is (internal, not user-facing) — this is a copy convention, not a rename.
- [x] **Onboarding location capture is now address-first, not geolocation-first**: every member types their address (geocoded via Mapbox), which is always jittered into an `approx_lat/lng` — geolocation's silent-failure mode (permission denied, unsupported browser) meant some new members got no pin at all. "Hide my tools' location" no longer skips capturing a location; it only controls `map_pin_hidden` (map visibility), since a location is needed regardless for things like Find a Group proximity. The old "Random Pin" vs "Hide" choice UI is gone from `src/pages/Onboarding.jsx` — superseded, not just renamed.
- [x] **Rental duration units expanded to include "hour"** — was half_day/day/week/month, now hour/half_day/day/week/month, per real-testing feedback that short rentals weren't covered
- [x] **Search is now public, unauthenticated** — anyone can browse/search the full tool database without an account. `PublicLayout` wraps only `/` (Search); Tool Detail, My Tools, Groups, Favorites, Settings, and every action still sit behind `RequireAuth`, so the sign-up/login prompt naturally appears the moment someone wants more than a list view.
- [x] **Login/Signup got a visual "hero" banner** (`AuthHero` component) — stylized brushed-aluminum panel + oversized low-opacity wrench icon, standing in for a real photo until one's supplied. Wordmark color is now split by context: orange-red (`redOrange`) on the Login/Signup hero specifically, yellow (`safety`) everywhere else including Search — both are new/reused Tailwind tokens in `tailwind.config.js`. It also rotates through 3 taglines on a ~3.2s fade.
- [x] **Groups and Favorites are now wired to real data** — Groups: My Groups list, Find a Group (search by name/city/zip/neighborhood, proximity-sorted via `src/lib/geo.js` haversine using each side's persisted `approx_lat/lng`, invite-code entry as an alternate join path), Create New Group (`src/pages/CreateGroup.jsx` — auto-generates the invite code, creator is auto-approved as the first member), Group Detail (`src/pages/GroupDetail.jsx` — info card, admin-editable default exchange spot, admin inbox for pending join requests via `decide_group_membership`, and a filtered "tools in this group" list derived from `chest_id → approved group_memberships`, matching the "derived, not stored" rule). Favorites: heart-toggle on Tool Detail (logs `favorite_added`), standalone Favorites list page with quick-unfavorite.
  - **Schema fix required for this to work**: `group_memberships`' original RLS only let you see your own membership row or every row for a group you admin — too narrow for "tap a group, see its tools" and member counts, which need to read *other* people's *approved* rows. Added `supabase/migrations/0004_group_memberships_approved_visibility.sql` (additive policy: approved rows are visible to any authenticated user, same trust level as the `groups` table itself; pending/denied stay private). **This migration must be applied via the Supabase SQL editor before Groups will fully work live** — same manual step as 0002/0003.
  - **Known simplifications** (consistent with the no-Mapbox-yet state elsewhere): a new group's map pin (`approx_lat/lng`) defaults to its creator's own approximate location rather than being placed on a map; "Find a Group" search matches the group's own name/city/zip/neighborhood fields only — the deeper "tools offered by member chests" search dimension from `docs/technical-design.md` isn't implemented yet; no pending-request attention-dot badge on the Groups tab yet.
- [x] **UI reference baseline locked**: `toolber-directions.html` (Motorsport direction selected) reflects every visual decision made so far — aluminum-drawer card background, 6-tooth cog Settings icon, filter button, scrollable results list, comma-separated search copy, right-aligned rotating tagline, blue group pins/red-orange chest pins on the map (no on-screen legend — deemed unnecessary). Treat this as source of truth for "what does the UI currently look like" going forward.
- [x] **Bottom nav is now 5 tabs, not 6**: Search, **My Tools** (renamed from "My Chest"), Groups, Favorites, Settings (gear icon, not "Profile")
- [x] **Requests is no longer a top-level tab** — it's a sub-section/subject inside **My Tools** (incoming/outgoing borrow requests, malfunction alerts, meeting reminders)
- [x] **Groups screen has two entry points**: "Create New" and "My Groups". A group you've requested to join but haven't heard back on shows a **"Pending"** badge in the list.
- [x] Settings is the single hub for profile info/bio/photo, notifications, privacy, proximity, and a payment-settings section stubbed for the later monetization phase
- [x] **Tool photos: up to 3, swipeable gallery** (dot indicator) on the tool detail screen — not just a single photo
- [x] Search placeholder copy: comma-separated examples, no quotation marks
- [x] Map shows only pins matching the current search/filter — not pre-populated with everything
- [x] Results list below the map scrolls independently of the header/map

## Notification channels — email and push are separate (2026-09-03)
- [x] **`email_enabled` and `push_enabled` sit above the per-category preferences** (`0044_notification_channels.sql`). One preference per category used to gate both channels at once, so there was no way to say "buzz my phone but stop filling my inbox" — and getting both for every event is a lot of noise for one piece of news.
- [x] **Deliberately at the channel level, not per category.** Nine categories times two channels is eighteen toggles to express "email is too much", which is the axis people actually hold an opinion about.
- [x] Both **default on**, so nothing changes for anyone already signed up until they choose.
- [x] The existing **per-device** push switch stays and now nests under the account-level one, hidden when push is off account-wide — a device switch that changes nothing is worse than no switch. Push registration is inherently per-browser; the account switch spans devices.
- [x] Turning email off also silences the email-only "Toolber updates" categories (functional/community/marketing). **Account and security mail from Supabase Auth is unaffected** and the UI says so.

## Search origin — a default that costs no permission (2026-09-03)
- [x] **"Use my default location"** in the Search near menu sets the origin from the profile's own `approx_lat/lng`. Replaces "Back to my own area", which called `onChange(null)` — clearing the origin rather than resetting it, which switched off proximity ordering entirely and hid the map's re-center control. Granting location permission was the only way back, i.e. exactly the prompt the default exists to avoid.
- [x] Re-center control is a **plain white circle below mapbox's zoom buttons** — it was overlapping them, and an earlier asphalt/safety-yellow restyle was rejected.

## Distribution strategy — reaffirmed
- [x] **PWA first, Capacitor/native wrap later — confirmed, not reopened.** Even with TestFlight, native testing needs an Apple Developer Program membership, a Mac build pipeline, and a lightweight review pass for external testers. A PWA is just a link — zero install/review friction, works cross-platform immediately, supports fail-fast testing. Same build gets wrapped into native apps later without a rewrite; not committing to the current `toolber.jsx` code doesn't change this reasoning.
- [x] Not carrying forward the current `toolber.jsx` code as-is — the general visual/interaction feel is good, UI will be more deliberately (re)designed, not ported verbatim

## Analytics & feedback
- [x] Usage stats via a **self-hosted `events` table + internal dashboard** in the same Supabase project — no third-party analytics vendor
- [x] Key product actions (signup, tool listed, search performed, borrow requested/approved/denied, group joined, favorite added, etc.) log an event automatically as a side effect
- [x] Dashboard restricted to `profiles.is_platform_admin = true` (you) — not a third-party tool, not publicly visible
- [x] Always-visible **floating feedback button**, single free-text field ("Any improvements or suggestions?"), reachable from anywhere in the app

## Certification — reconsidered and removed
- [x] **No competency-certification system.** Removed after reconsidering: requiring a per-tool "I certify I'm able to use this safely" checkbox was judged condescending (no hardware store makes you sign a competency waiver to buy a tool), and *offering/requiring lender supervision* can actually increase a lender's liability exposure by implying an assumed duty of care — the opposite of what a lender wants.
- [x] **Replaced with:** (1) ToS clauses — borrowers acknowledge inherent risk in using a borrowed tool, lenders acknowledge responsibility/risk if their tool is misused, accepted once at ToS-acceptance time, not re-litigated per borrow; (2) a simple opt-in **"I'd like a quick walkthrough on using this tool"** checkbox on any borrow request — pure convenience signal to the owner, no attestation, no persistent record, no liability mechanism
- [x] **Stationary-tool "supervised access" toggle stays** (kept the recommended option) — different rationale from certification: it's about whether the owner needs to be physically present for tools that can't leave the property, not about certifying competence. `tool_authorizations.supervision_required` persists per (borrower, tool), owner can exempt a specific borrower at any time, but there's no more "certified" field it's independent from — it's now just an access-logistics record.

## Map pin privacy model (corrects an earlier bug in the design)
- [x] Every **chest** gets its own persisted approximate map pin (`approx_lat/lng`) — not a shared group-wide point. Fixes a stacking bug where all of one group's members would've rendered on the same pin.
- [x] The pin is generated **once and stored** — never regenerated per view/session/group. Re-randomizing on every view is an actual privacy regression (averaging attack reconstructs the true point from repeated samples), not an improvement.
- [x] Auto-jitter mode: random point within an owner-chosen radius (correct disc-uniform math), **snapped to the nearest real street/intersection** via Mapbox Tilequery so it reads as a plausible address
- [x] Manual mode: owner (for their chest) or group admin (for the group's own reference point) can hand-place the pin instead
- [x] **No app-wide default radius** — owner must explicitly set a radius or manually place a pin before their chest can list tools or appear in search. Nothing silently defaults.
- [x] Group's own `approx_lat/lng` is a separate, admin-settable general reference point — never what individual tool pins are plotted at
- [x] **Groups are also pinned on the map**, as their own marker layer, at their own `approx_lat/lng`
- [x] Owners can **opt out of the map entirely** (`map_pin_hidden`) — tools stay findable via the textual list view, just no pin
- [x] Pin styling: teardrop markers. **Chest pins: red-orange, standard size. Group pins: blue, slightly larger.** Hover shows a thumbnail photo and/or short description in a popover.

## Backlog / future ideas (explicitly not being built now)
- [ ] Native app store wrapper (Capacitor or similar) for iOS/Android
- [ ] Payments (Stripe Connect, payout handling, 10% platform fee)
- [ ] Native push via APNs/FCM directly — only if the Web Push API proves insufficient; it is what ships today
- [ ] Ratings/reviews, damage/dispute handling, any insurance considerations
- [ ] How-to videos from "personalities"
- [ ] AI photo-based tool name suggestion (see Expanded scope above)
- [ ] Invite-sharing to SMS/WhatsApp/Facebook/Reddit/Nextdoor (exists in MVP UI as stubs — fine to keep stubbed a while longer)
- [ ] UI polish beyond what already exists in `toolber.jsx`

---
*Updated as we go — tell me any time to add, cut, or re-prioritize an item.*
