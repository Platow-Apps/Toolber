-- ============================================================
-- 0046 — `revoke ... from public` never kept anon out
-- ============================================================
-- Thirty-five migrations end with some variant of
--
--     revoke execute on function foo(...) from public;
--     grant  execute on function foo(...) to authenticated;
--
-- and the first line is a no-op with respect to anon. Supabase ships default
-- privileges that grant EXECUTE on every new function in `public` to anon,
-- authenticated and service_role *explicitly* -- not through PUBLIC. Revoking
-- PUBLIC removes a grant that was never the one letting anon in, and the
-- explicit anon=X grant stands untouched.
--
-- This is the same shape as the column-grant trap already recorded in
-- CLAUDE.md: a REVOKE that reads like protection, changes nothing, and leaves
-- no trace of having failed. It was found by resetting a local database and
-- discovering that four assertions which pass against an incrementally-built
-- schema fail against one the migrations build from scratch.
--
-- WHAT WAS ACTUALLY EXPOSED
--
-- Less than the privilege list suggests, because the function bodies were
-- doing the work the grants were believed to be doing: 26 of them open with
-- `if auth.uid() is null then raise exception`, and get_pickup_location()
-- re-checks the borrow relationship on every call (0010). The defence was one
-- layer deep instead of two, everywhere.
--
-- The unguarded ones are the reason this is worth a migration rather than a
-- comment. send_overdue_reminders() inserts notifications, and a notification
-- insert fires the trigger that sends email -- so an unauthenticated caller
-- holding the publishable key could drive the mailer. refresh_tool_state()
-- and refresh_group_pin() are unauthenticated writes to tools.status and
-- groups.approx_lat/lng; both recompute derived values rather than accepting
-- input, which is what keeps this a hardening fix and not an incident.

-- ── Every function loses anon ──────────────────────────────────────────
-- Written as a sweep rather than a list because the problem is systemic: a
-- list would have to be right about all 41, and a later function added with
-- the same mistaken revoke would not be in it.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end;
$$;

-- ── ...except the one that is genuinely public ─────────────────────────
-- Search works signed out by design: someone should be able to see what the
-- neighborhood lends before making an account. search_tools is SECURITY
-- INVOKER and reads only columns anon is already granted, so it is public in
-- the same sense the tools table is.

grant execute on function search_tools(text, numeric, numeric, integer) to anon;

-- ── Internal functions lose authenticated too ──────────────────────────
-- None of these is called from the client (checked against every supabase.rpc
-- in src/). They are trigger bodies, a cron job, and helpers invoked from
-- inside other SECURITY DEFINER functions -- which run as the owner, so
-- removing the caller's privilege does not affect them.
--
-- refresh_tool_state and refresh_group_pin were meant to be internal already;
-- 0024, 0027, 0028 and 0037 each said so with a revoke from public, and the
-- pgTAP suite has asserted it since. The assertion was passing for the wrong
-- reason on a database built by hand, and failing honestly on one built by
-- these migrations.

revoke execute on function handle_new_user() from authenticated;
revoke execute on function handle_new_profile_prefs() from authenticated;
revoke execute on function trigger_notify_edge_function() from authenticated;
revoke execute on function notify_new_borrow_message() from authenticated;
revoke execute on function notify_new_conversation_message() from authenticated;
revoke execute on function refresh_tool_state(uuid) from authenticated;
revoke execute on function refresh_group_pin(uuid) from authenticated;
revoke execute on function send_overdue_reminders() from authenticated;
revoke execute on function generate_invite_code(integer) from authenticated;

-- ── Stop it happening again ────────────────────────────────────────────
-- The sweep above fixes the 41 functions that exist. This is what stops the
-- 42nd from arriving anon-executable because someone wrote the revoke that
-- reads correctly and does nothing. A function that genuinely should be
-- public now has to say so, which is the right way round.

alter default privileges in schema public revoke execute on functions from anon;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_leaked text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
  into v_leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname <> 'search_tools'
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_leaked is not null then
    raise exception 'still callable by anon: %', v_leaked;
  end if;

  if not has_function_privilege('anon', 'search_tools(text, numeric, numeric, integer)', 'EXECUTE') then
    raise exception 'search_tools must stay public -- signed-out search is a product decision';
  end if;

  if not has_function_privilege('authenticated', 'request_borrow(uuid, boolean, integer, text)', 'EXECUTE') then
    raise exception 'the sweep took a grant a signed-in user needs';
  end if;
end;
$chk$;
