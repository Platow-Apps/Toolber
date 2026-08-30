-- Self-serve account deletion, as promised by the privacy policy.
--
-- WHY THIS SCRUBS RATHER THAN DELETES THE ROW
--
-- Seven foreign keys into `profiles` carry no ON DELETE action, so Postgres
-- refuses to delete a profile that has any borrow history, any message sent,
-- any group it administers, or any malfunction report it filed:
--
--   groups.admin_id, borrow_requests.borrower_id / lender_id /
--   delegated_approver_id, tool_malfunction_reports.reported_by,
--   tool_authorizations.updated_by, conversation_messages.sender_id
--
-- Those rows are also somebody else's record. A neighbour's history of who
-- borrowed their circular saw, and the conversation they had about it, does
-- not stop being theirs because the other party left. Deleting it would be
-- the same mistake delete_tool() was written to prevent.
--
-- So: everything personal is removed or blanked, everything owned is deleted,
-- and the row survives as an anonymous tombstone that the counterparty's
-- records can still point at. That is exactly what the privacy policy
-- describes.
--
-- LIMITATION, stated plainly: this does not remove the row in auth.users, so
-- the email address survives in the auth schema and cannot be reused. Purging
-- it needs the admin API from an Edge Function *and* rework of the seven
-- constraints above. Tracked as a follow-up; the app blocks sign-in for a
-- deleted account in the meantime.
--
-- Safe to paste and re-run from the top.

alter table profiles add column if not exists deleted_at timestamptz;

grant select (deleted_at) on profiles to authenticated;

create or replace function delete_my_account()
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_open integer;
  v_orphan_groups integer;
  v_photos text[];
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;

  -- Leaving mid-loan strands the other party: they lose the record of who
  -- has their tool, or who lent them the one in their garage.
  select count(*) into v_open
  from borrow_requests
  where status in ('pending', 'approved')
    and (borrower_id = v_me or lender_id = v_me);

  if v_open > 0 then
    raise exception 'You have % open borrow request(s). Finish or cancel them before deleting your account.', v_open;
  end if;

  -- A group with no admin cannot approve joins or show its invite code, and
  -- nothing in the app can appoint a replacement yet.
  select count(*) into v_orphan_groups
  from groups g
  where g.admin_id = v_me
    and exists (
      select 1 from group_memberships gm
      where gm.group_id = g.id and gm.profile_id <> v_me and gm.status = 'approved'
    );

  if v_orphan_groups > 0 then
    raise exception 'You administer % group(s) with other members. Remove the members or hand the group over first.', v_orphan_groups;
  end if;

  -- Photo paths go back to the caller so it can clear Storage; Postgres has
  -- no visibility into the bucket.
  select coalesce(array_agg(p), array[]::text[]) into v_photos
  from (select unnest(photos) as p from tools where chest_id = v_me) paths;

  -- Owned content. Groups this user admins with no other members go too.
  delete from tools where chest_id = v_me;
  delete from favorites where profile_id = v_me;
  delete from group_memberships where profile_id = v_me;
  delete from groups where admin_id = v_me;
  delete from notifications where profile_id = v_me;
  delete from notification_preferences where profile_id = v_me;

  -- Everything that identifies a person. What stays is a row with no name,
  -- no contact details and no location, so the counterparty's borrow history
  -- and messages still resolve to *someone* without saying who.
  update profiles set
    display_name = 'Deleted user',
    avatar_url = null,
    phone = null,
    home_lat = null,
    home_lng = null,
    approx_lat = null,
    approx_lng = null,
    pin_radius_meters = null,
    map_pin_hidden = true,
    profile_complete = false,
    auto_approve_vetted_borrowers = false,
    is_platform_admin = false,
    deleted_at = now()
  where id = v_me;

  return v_photos;
end;
$$;

revoke execute on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;
