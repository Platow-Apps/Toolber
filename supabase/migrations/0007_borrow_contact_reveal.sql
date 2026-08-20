-- Once a borrow_request is approved, both sides could already see the
-- pickup location -- but had no way to actually reach each other to
-- arrange a time. This adds a phone number (optional) and a
-- get_borrow_contact() RPC that reveals the OTHER party's contact info
-- (email always, phone if they've set one) once -- and only once -- a
-- specific request between them is approved. Same trust model as
-- get_pickup_location(): locked column, RPC-gated, no broad grant.

alter table profiles add column phone text;

-- profiles' column grants are already narrowed (see 0001_init.sql) to a
-- fixed list that intentionally excludes home_lat/home_lng and now phone.
-- profiles_select_all's RLS policy is `using (true)` -- wide open at the row
-- level -- so there's no way to make "you can read your own phone but not
-- anyone else's" happen via GRANT/RLS alone (column grants aren't
-- conditional, and the row policy already permits every row to everyone).
-- Hence two narrow RPCs below instead: one for reading your own phone back
-- (Settings needs to prefill the field), one for reading a borrow
-- counterpart's contact info once approved. UPDATE was never column-
-- restricted (profiles_update_own has no column grant narrowing), so
-- saving your own phone from Settings works with a normal client update --
-- no RPC needed for writes, only reads.

create function get_my_contact_info()
returns table (phone text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select p.phone from profiles p where p.id = auth.uid();
end;
$$;

create function get_borrow_contact(p_request_id uuid)
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
begin
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

  return query
    select p.display_name, u.email::text, p.phone
    from profiles p
    join auth.users u on u.id = p.id
    where p.id = v_counterpart_id;
end;
$$;
