-- "Make Search public" (see docs/feature-checklist.md, PublicLayout in
-- src/App.jsx) only removed the frontend's login redirect. It never granted
-- the database's anon role (genuinely logged-out visitors — no session at
-- all, distinct from Supabase's "authenticated" role) any actual read
-- access. Every relevant RLS policy and column grant was scoped
-- `to authenticated` only, so a truly anonymous visitor's queries were
-- silently RLS-filtered to empty results — confirmed by querying the REST
-- API directly with only the anon key and no user JWT: tools and groups
-- both returned `[]` despite real rows existing.
--
-- IMPORTANT: this migration explicitly REVOKEs before re-GRANTing on tools
-- and profiles, even though it looks redundant. anon's default privileges
-- were never touched by 0001_init.sql (which only revoked from
-- `authenticated`), so anon may still hold Postgres/Supabase's original
-- unrestricted default grant on these tables. Adding an RLS SELECT policy
-- for anon *without* first revoking that default would let anon read
-- pickup_location / home_lat / home_lng the moment the policy went live --
-- column grants, not RLS, are what protect those columns (see CLAUDE.md ->
-- Patterns to Follow -> Pickup location handling). The REVOKE removes any
-- such default before the safe, restricted column list is re-granted.

revoke select on tools from anon;
grant select (
  id, crib_id, name, category, kind, description, photos, portable,
  supervised_required, monetize, price, price_duration_unit, status,
  search_vector, created_at, updated_at
) on tools to anon;
-- pickup_location intentionally NOT granted — same rule as the authenticated grant.

revoke select on profiles from anon;
grant select (
  id, display_name, avatar_url, approx_lat, approx_lng, map_pin_hidden,
  profile_complete, is_platform_admin, theme_preference, created_at
) on profiles to anon;
-- home_lat/home_lng intentionally NOT granted — same rule as the authenticated grant.

-- groups has no sensitive columns (default_exchange_location and invite_code
-- are both meant to be discoverable/non-secret by design — see
-- docs/technical-design.md -> Create a group), so no column-level grant is
-- needed here, just row-level access.

create policy tools_select_anon on tools for select to anon using (true);
create policy profiles_select_anon on profiles for select to anon using (true);
create policy groups_select_anon on groups for select to anon using (true);
