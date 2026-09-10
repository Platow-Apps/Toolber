-- Asking is not yet an introduction.
--
-- 0057 let any borrow request, in either direction and at any status, reveal
-- a private owner's name. The reasoning was that asking to borrow is an act
-- of introduction. It is -- but only in one direction. Read the other way it
-- means a stranger can surface the name of an owner who deliberately hid it
-- by sending a request that never gets accepted, and then walking away. That
-- is a disclosure the owner never agreed to, triggered entirely by somebody
-- else.
--
-- So the rule is asymmetric, on purpose, because the two sides are not doing
-- the same thing:
--
--   I am the lender, they asked me    -> I see their name straight away.
--     I am being asked to hand a stranger a tool, and the name is most of
--     what I have to decide on. Withholding it until I approve would mean
--     approving blind, which is the one thing this app must not ask of
--     anybody. Someone who is private and chooses to ask is disclosing
--     themselves, to one person, by their own act.
--
--   I am the borrower, I asked them   -> I see their name once they say yes.
--     Their disclosure, their decision, their timing.
--
-- A conversation still reveals both ways, but start_conversation() will no
-- longer open one against somebody whose identity you are not already
-- entitled to see -- otherwise it is the same hole with a different door. The
-- UI already hides the control, and this is the half that does not depend on
-- the UI.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- 1. The predicate
-- ============================================================
create or replace function owner_identity_visible(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    -- No account, no identity.
    when p_owner is null or auth.uid() is null then false
    when auth.uid() = p_owner then true
    when not coalesce((select identity_private from profiles where id = p_owner), false)
      then true
    else
      -- An approved group in common.
      exists (
        select 1
        from group_memberships mine
        join group_memberships theirs on theirs.group_id = mine.group_id
        where mine.profile_id = auth.uid() and mine.status = 'approved'
          and theirs.profile_id = p_owner and theirs.status = 'approved'
      )
      -- They asked to borrow from me, at any status. I cannot answer a
      -- request from nobody.
      or exists (
        select 1
        from borrow_requests br
        join tools t on t.id = br.tool_id
        where br.borrower_id = p_owner and t.chest_id = auth.uid()
      )
      -- I asked to borrow from them, and they said yes. 'completed' is here
      -- as well as 'approved' because a loan that has come back does not
      -- un-introduce two people -- gating on 'approved' alone would hide a
      -- name again the moment the tool was returned.
      or exists (
        select 1
        from borrow_requests br
        join tools t on t.id = br.tool_id
        where br.borrower_id = auth.uid() and t.chest_id = p_owner
          and br.status in ('approved', 'completed')
      )
      -- Or a conversation, which cannot show "them" for a name. Guarded at
      -- the point one is opened, below.
      or exists (
        select 1 from conversations c
        where (c.participant_a_id = auth.uid() and c.participant_b_id = p_owner)
           or (c.participant_a_id = p_owner   and c.participant_b_id = auth.uid())
      )
  end;
$fn$;

revoke execute on function owner_identity_visible(uuid) from public;
grant execute on function owner_identity_visible(uuid) to anon, authenticated;

-- ============================================================
-- 2. The door the UI cannot hold shut
-- ============================================================
-- ToolDetail already declines to offer Start Chat when it has no chest_id,
-- which is the case for a private owner. But `authenticated` still holds the
-- column grant on tools.chest_id -- the app needs it on half a dozen screens
-- -- so a signed-in stranger can read the id straight off the REST API and
-- call this directly. Without the check below, that call opens a conversation
-- and the name falls out of the predicate above. The refusal is what makes
-- the private setting mean something against somebody who is trying.
create or replace function start_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_other_user_id = auth.uid() then
    raise exception 'Cannot start a conversation with yourself';
  end if;
  if not exists (select 1 from profiles where id = p_other_user_id) then
    raise exception 'User not found';
  end if;

  -- Worded as "not available" rather than "they are private": confirming
  -- which of the two it is would itself disclose something about them.
  if not owner_identity_visible(p_other_user_id) then
    raise exception 'This neighbor is not available to message';
  end if;

  select id into v_conversation_id from conversations
  where (participant_a_id = auth.uid() and participant_b_id = p_other_user_id)
     or (participant_a_id = p_other_user_id and participant_b_id = auth.uid());

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  begin
    insert into conversations (participant_a_id, participant_b_id)
    values (auth.uid(), p_other_user_id)
    returning id into v_conversation_id;
  exception when unique_violation then
    select id into v_conversation_id from conversations
    where (participant_a_id = auth.uid() and participant_b_id = p_other_user_id)
       or (participant_a_id = p_other_user_id and participant_b_id = auth.uid());
  end;

  return v_conversation_id;
end;
$$;

revoke execute on function start_conversation(uuid) from public, anon;
grant execute on function start_conversation(uuid) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_visible boolean;
begin
  -- Signed out, nobody is visible. Cheap, and it is the assertion that broke
  -- when this function was last rewritten.
  set local request.jwt.claims = '{"role":"anon"}';
  set local role anon;
  select owner_identity_visible(gen_random_uuid()) into v_visible;
  reset role;

  if v_visible then
    raise exception 'owner_identity_visible answers true with no account';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'start_conversation'
      and pg_get_functiondef(p.oid) like '%owner_identity_visible%'
  ) then
    raise exception 'start_conversation lost its identity check';
  end if;
end;
$chk$;
