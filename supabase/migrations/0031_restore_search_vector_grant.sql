-- Fixes: "permission denied for table tools" on any non-empty search.
--
-- search_vector was granted to anon and authenticated in 0001 and 0006. Both
-- 0026 and 0029 needed to change its generated expression, and a generated
-- column's expression cannot be altered in place -- it has to be dropped and
-- re-added. **Dropping a column drops its privileges with it**, and the
-- re-added column was never re-granted.
--
-- PostgREST's .textSearch() filters on that column, and filtering requires
-- SELECT privilege on it, so every typed query failed. An empty query never
-- touches search_vector, which is why browsing looked fine and only searching
-- broke -- and why the map went blank rather than erroring: the map view
-- rendered zero pins from the failed query's empty result.
--
-- THE TRAP, for next time: any future rebuild of search_vector must re-run
-- the grant below in the same migration. Dropping a column is not a
-- privilege-preserving operation the way renaming one is.
--
-- Safe to paste and re-run from the top.

grant select (search_vector) on tools to anon, authenticated;

-- Verify rather than assume -- this is the second time this column has lost
-- its grant, so fail loudly here rather than in front of a user.
do $$
declare
  v_missing text;
begin
  select string_agg(role_name, ', ')
  into v_missing
  from (
    select r.role_name
    from (values ('anon'), ('authenticated')) as r(role_name)
    where not has_column_privilege(r.role_name, 'tools', 'search_vector', 'SELECT')
  ) missing;

  if v_missing is not null then
    raise exception 'search_vector is still not selectable by: %', v_missing;
  end if;

  raise notice 'search_vector is selectable by anon and authenticated — search works.';
end;
$$;
