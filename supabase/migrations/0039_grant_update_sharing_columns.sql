-- The sharing switches in Settings could not be changed.
--
-- 0009 revoked table-level UPDATE on profiles and granted an explicit column
-- list, so that nobody could set is_platform_admin or
-- has_payment_method_on_file on themselves (PRIV-1/PRIV-2). That is right, and
-- it has the same consequence as the SELECT version: a column added later is
-- not updatable until it is named here.
--
-- Three were added and never granted:
--   share_email_on_approval, share_phone_on_approval (0033)
--   chest_public                                     (0038)
--
-- The failure was invisible rather than loud. Settings updates optimistically
-- and reverts on error, so the checkbox moved, the write was refused, and the
-- checkbox moved back -- which reads as a stuck control, not a permission
-- problem. The UI now surfaces the error too; this makes there not be one.
--
-- None of the three is sensitive in the way the excluded columns are. They
-- decide what a person shares about themselves, which is exactly the kind of
-- thing that should be theirs to change.
--
-- Safe to paste and re-run from the top.

grant update (
  share_email_on_approval,
  share_phone_on_approval,
  chest_public
) on profiles to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
-- Asserts both halves: the three that should now be writable, and the two that
-- must never be. A later migration that re-grants UPDATE at table level would
-- fail here rather than quietly reopening the privilege-escalation hole 0009
-- closed.
do $chk$
declare
  v_col text;
begin
  foreach v_col in array array[
    'share_email_on_approval', 'share_phone_on_approval', 'chest_public',
    -- Regression guard: these were already granted and the app depends on them.
    'display_name', 'phone', 'profile_complete', 'map_pin_hidden'
  ] loop
    if not has_column_privilege('authenticated', 'profiles', v_col, 'update') then
      raise exception 'profiles.% is not updatable by authenticated', v_col;
    end if;
  end loop;

  foreach v_col in array array['is_platform_admin', 'has_payment_method_on_file'] loop
    if has_column_privilege('authenticated', 'profiles', v_col, 'update') then
      raise exception 'profiles.% is updatable by authenticated -- that is the PRIV-1 escalation 0009 closed', v_col;
    end if;
  end loop;
end;
$chk$;
