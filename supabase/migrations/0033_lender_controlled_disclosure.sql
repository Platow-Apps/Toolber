-- The lender decides what an approved borrower actually receives.
--
-- Until now, approving a request handed over a fixed bundle: the exact
-- pickup address, the lender's email, and their phone number if set. That was
-- one decision ("approve") doing three disclosures, none of them chosen.
--
-- Now:
--   * a tool can carry a general location ("Near Oak Hill Park, garage on the
--     left") and the owner can choose to share that instead of a street
--     address, revealing the exact spot by message once they've decided they
--     want to;
--   * email and phone each have their own switch, and phone now defaults to
--     OFF. In-app messaging always works, so a lender who shares neither can
--     still coordinate.
--
-- Defaults preserve today's behaviour for the address and email, and tighten
-- only phone -- the most personal of the three, and the one a borrower least
-- needs to collect a drill.
--
-- Safe to paste and re-run from the top.

alter table profiles add column if not exists share_email_on_approval boolean not null default true;
alter table profiles add column if not exists share_phone_on_approval boolean not null default false;

grant select (share_email_on_approval, share_phone_on_approval) on profiles to authenticated;

alter table tools add column if not exists general_location text;
alter table tools add column if not exists reveal_exact_location boolean not null default true;

-- general_location is deliberately NOT public: it is still a hint about where
-- someone lives, so it follows pickup_location's rule and is reachable only
-- through get_pickup_location(), by an approved borrower.
grant select (reveal_exact_location) on tools to anon, authenticated;

-- ============================================================
-- get_pickup_location — honour the owner's choice
-- ============================================================

create or replace function get_pickup_location(p_tool_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location text;
  v_general text;
  v_reveal boolean;
  v_owner_id uuid;
begin
  select chest_id, pickup_location, general_location, reveal_exact_location
  into v_owner_id, v_location, v_general, v_reveal
  from tools where id = p_tool_id;

  -- The owner always sees their own exact address back; that is how the edit
  -- form pre-fills.
  if v_owner_id = auth.uid() then
    return v_location;
  end if;

  if not exists (
    select 1 from borrow_requests
    where tool_id = p_tool_id
      and borrower_id = auth.uid()
      and status = 'approved'
      and decided_at > now() - interval '30 days'
  ) then
    raise exception 'No approved request for this tool';
  end if;

  if coalesce(v_reveal, true) then
    return v_location;
  end if;

  -- Withheld: hand over whatever general description the owner wrote, and
  -- say plainly that the rest is coming by message rather than returning
  -- something that looks like a failure.
  return coalesce(
    nullif(trim(v_general), ''),
    'The owner will share the exact pickup spot by message.'
  );
end;
$$;

revoke execute on function get_pickup_location(uuid) from public;
grant execute on function get_pickup_location(uuid) to authenticated;

-- ============================================================
-- get_borrow_contact — per-channel, and honour the counterpart's switches
-- ============================================================
-- Returns NULL for a channel the other person hasn't shared, rather than
-- failing: the caller renders what it gets and points at in-app messaging
-- for the rest.

create or replace function get_borrow_contact(p_request_id uuid)
returns table (display_name text, email text, phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrower_id uuid;
  v_lender_id uuid;
  v_status borrow_request_status;
  v_counterpart_id uuid;
  v_share_email boolean;
  v_share_phone boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select borrower_id, lender_id, status into v_borrower_id, v_lender_id, v_status
  from borrow_requests where id = p_request_id;

  if v_status is null then
    raise exception 'Request not found';
  end if;
  if v_status != 'approved' then
    raise exception 'Contact info is only available once a request is approved';
  end if;

  if auth.uid() = v_borrower_id then
    v_counterpart_id := v_lender_id;
  elsif auth.uid() = v_lender_id then
    v_counterpart_id := v_borrower_id;
  else
    raise exception 'Not a party to this request';
  end if;

  select p.share_email_on_approval, p.share_phone_on_approval
  into v_share_email, v_share_phone
  from profiles p where p.id = v_counterpart_id;

  return query
  select
    p.display_name,
    case when coalesce(v_share_email, true) then u.email::text else null end,
    case when coalesce(v_share_phone, false) then p.phone else null end
  from profiles p
  join auth.users u on u.id = p.id
  where p.id = v_counterpart_id;
end;
$$;

revoke execute on function get_borrow_contact(uuid) from public;
grant execute on function get_borrow_contact(uuid) to authenticated;
