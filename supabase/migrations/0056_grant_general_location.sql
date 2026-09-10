-- ============================================================
-- 0056 — general_location was never readable, so editing a tool failed
-- ============================================================
-- 0033 added tools.general_location alongside reveal_exact_location and
-- granted only the second of them. tools has an explicit SELECT column list
-- (0001), so the first has been unreadable ever since — and the edit form
-- selects it, which means the whole select was refused with "permission
-- denied for table tools".
--
-- The symptom did not look like a permissions problem. The form rendered
-- with every field blank and no photos, as though editing meant starting the
-- listing again, and the error sat at the bottom above a disabled Save. One
-- refused column takes the entire row with it.
--
-- Nothing else reads the column, which is why it went unnoticed: only the
-- edit form does, and only an owner editing an existing tool reaches it.
--
-- It is not sensitive. reveal_exact_location = false is precisely the case
-- where an owner has chosen to publish a vague location instead of an exact
-- one, so the vague one is meant to be seen. The exact address stays where
-- it was: pickup_location remains ungranted and reachable only through
-- get_pickup_location().

grant select (general_location) on tools to anon, authenticated;

do $chk$
begin
  if not has_column_privilege('authenticated', 'tools', 'general_location', 'SELECT') then
    raise exception 'general_location is still unreadable';
  end if;

  -- The one that must never join it.
  if has_column_privilege('authenticated', 'tools', 'pickup_location', 'SELECT') then
    raise exception 'pickup_location became readable -- it is RPC-only by design';
  end if;
end;
$chk$;
