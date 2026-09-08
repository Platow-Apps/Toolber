-- ============================================================
-- 0049 — spotting a tool you have already listed
-- ============================================================
-- The check that shipped in the form compared names with ilike, which is an
-- exact match. "Heater Gun" and "Heat Gun" are the same heat gun, wearing the
-- same photograph, and it said nothing about either of them.
--
-- Two signals, because neither is reliable alone:
--
--   * The name, fuzzily. pg_trgm scores 'heater gun' against 'heat gun' at
--     roughly 0.67 -- comfortably over the 0.4 threshold used below, which is
--     itself above pg_trgm's default 0.3 to keep genuinely different tools
--     ("hammer drill" vs "hammer") from nagging.
--   * The photograph, exactly. The same image bytes on two listings is a much
--     stronger signal than any name comparison, and it is the one that
--     survives someone renaming a tool entirely.
--
-- Still only a warning. Owning two of the same tool is ordinary, so this
-- migration deliberately adds no unique constraint: the database's job here is
-- to answer "have you seen this before?", not to refuse.

create extension if not exists pg_trgm;

-- ============================================================
-- photo_hashes — content hashes, positional with photos
-- ============================================================
-- Parallel to tools.photos rather than a side table: they are written in the
-- same statement, by the same form, and a row whose hashes disagree with its
-- photos would be a bug in one place rather than a join to maintain. Entries
-- may be null -- every photo uploaded before this migration has no hash, and
-- crypto.subtle is unavailable outside a secure context.

alter table tools
  add column if not exists photo_hashes text[];

comment on column tools.photo_hashes is
  'SHA-256 of each photo''s bytes, positional with photos. Null entries are expected: photos predating 0049, or a client with no crypto.subtle. Only ever used to ask whether a listing is a duplicate.';

-- The column-grant trap (CLAUDE.md): tools has an explicit SELECT column list,
-- so a new column is unreadable until named. Editing a tool has to read these
-- back to keep them aligned with the photos it did not touch.
--
-- No secrecy is lost by granting it. The photos themselves are public objects
-- in a public bucket, so anyone who can see a listing can already compute
-- these hashes for themselves.
grant select (photo_hashes) on tools to anon, authenticated;

-- ============================================================
-- find_similar_tools
-- ============================================================
-- SECURITY DEFINER and scoped to auth.uid()'s own chest. This is not about
-- finding duplicates across the app -- two neighbors owning the same drill is
-- the entire point of Toolber -- only about one person listing one tool twice.

create or replace function find_similar_tools(
  p_name text,
  p_photo_hashes text[] default null,
  p_exclude_tool_id uuid default null
)
returns table (
  id uuid,
  name text,
  matched_photo boolean,
  name_similarity real
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;

  -- Nothing to compare against. Returning no rows rather than raising: an
  -- empty form is a normal state on the way to a filled one.
  if v_name = '' and coalesce(array_length(p_photo_hashes, 1), 0) = 0 then
    return;
  end if;

  return query
  select
    t.id,
    t.name,
    -- Non-null hashes only. Two photos that both failed to hash are not the
    -- same photo, and && would happily match null-free arrays into a false
    -- positive if nulls were ever stripped upstream.
    coalesce(
      array_remove(p_photo_hashes, null) && array_remove(t.photo_hashes, null),
      false
    ) as matched_photo,
    similarity(lower(v_name), lower(t.name)) as name_similarity
  from tools t
  where t.chest_id = v_me
    and (p_exclude_tool_id is null or t.id <> p_exclude_tool_id)
    and (
      similarity(lower(v_name), lower(t.name)) >= 0.4
      or coalesce(
           array_remove(p_photo_hashes, null) && array_remove(t.photo_hashes, null),
           false
         )
    )
  -- A shared photograph outranks any name score: it is the stronger claim.
  order by matched_photo desc, name_similarity desc
  limit 3;
end;
$$;

revoke execute on function find_similar_tools(text, text[], uuid) from public, anon;
grant execute on function find_similar_tools(text, text[], uuid) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'pg_trgm is required for name similarity';
  end if;

  -- The case this migration exists for. If a future Postgres or pg_trgm
  -- changes scoring enough to drop this below the threshold, fail here rather
  -- than silently stopping warning anyone.
  if similarity('heater gun', 'heat gun') < 0.4 then
    raise exception
      'similarity(heater gun, heat gun) is %, below the 0.4 threshold the RPC uses',
      similarity('heater gun', 'heat gun');
  end if;

  if not has_column_privilege('authenticated', 'tools', 'photo_hashes', 'SELECT') then
    raise exception 'photo_hashes was added but not granted -- see the column-grant trap in CLAUDE.md';
  end if;

  if has_function_privilege('anon', 'find_similar_tools(text, text[], uuid)', 'EXECUTE') then
    raise exception 'find_similar_tools must not be callable by anon';
  end if;
end;
$chk$;
