-- Fixes the two CRITICAL findings from docs/audit-2026-08-20.md that are
-- currently exploitable on the live app. Both have exact fixes specified in
-- the audit; this migration applies them (with `phone` added to PRIV-1's
-- grant list, since 0007_borrow_contact_reveal.sql added that column after
-- the audit was written and Settings needs to keep being able to save it).

-- ============================================================
-- PRIV-1 / PRIV-2 — profiles had no column-level UPDATE grant, only the
-- SELECT side was ever locked down. Any signed-in user could currently run
-- `update profiles set is_platform_admin = true where id = auth.uid()` (or
-- has_payment_method_on_file, which combined with auto_approve_vetted_
-- borrowers would self-approve borrow requests and leak pickup locations --
-- PRIV-2 is the same hole, different payload). is_platform_admin and
-- has_payment_method_on_file are deliberately excluded below: both are
-- server-owned, never user-editable.
-- ============================================================
revoke update on profiles from authenticated;
grant update (
  display_name, avatar_url, home_lat, home_lng, approx_lat, approx_lng,
  pin_radius_meters, pin_placement_mode, map_pin_hidden, profile_complete,
  tos_accepted_at, tos_version, auto_approve_vetted_borrowers, theme_preference,
  phone
) on profiles to authenticated;

-- ============================================================
-- DOS-1 — report_malfunction() performed no authorization check at all.
-- Since tool ids are public (search is public), any signed-in user could
-- call it against any tool and immediately take it offline. Now requires
-- being the tool's owner, or having an approved/completed borrow_requests
-- row for it -- same relationship-based pattern already used by
-- get_pickup_location().
-- ============================================================
create or replace function report_malfunction(p_tool_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_owner_id uuid;
begin
  select crib_id into v_owner_id from tools where id = p_tool_id;

  if v_owner_id is null then
    raise exception 'Tool not found';
  end if;

  if v_owner_id != auth.uid() and not exists (
    select 1 from borrow_requests
    where tool_id = p_tool_id and borrower_id = auth.uid()
      and status in ('approved', 'completed')
  ) then
    raise exception 'Only the owner or a past borrower can report this tool';
  end if;

  insert into tool_malfunction_reports (tool_id, reported_by, note)
  values (p_tool_id, auth.uid(), p_note)
  returning id into v_report_id;

  update tools set status = 'unavailable_malfunction', updated_at = now() where id = p_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_owner_id, 'tool_malfunctioning', jsonb_build_object('tool_id', p_tool_id, 'report_id', v_report_id));

  return v_report_id;
end;
$$;
