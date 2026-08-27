-- Adds a separate "for sale" concept alongside the existing rental
-- monetization (monetize/price/price_duration_unit) -- a tool can be listed
-- as open to buy outright, independent of whether it's also offered for
-- rent. No buy/purchase flow exists yet (Toolber is free peer-to-peer at
-- launch, per CLAUDE.md); a prospective buyer sees the "for sale" flag and
-- inquires via the general chat (0019_general_messaging.sql) rather than
-- the price being posted publicly -- explicit product decision, asking
-- price is deliberately not a public column.
--
-- for_sale is public (same trust level as the rest of a tool's row).
-- asking_price is NOT granted to anyone -- same "column grant, not RLS,
-- protects it" shape as pickup_location -- reachable only through
-- get_asking_price(), which only the tool's own owner can call
-- successfully.
--
-- Safe to paste and re-run from the top: ADD COLUMN uses IF NOT EXISTS, the
-- for_sale grant is naturally idempotent (GRANT is additive), and the
-- function is CREATE OR REPLACE.

alter table tools add column if not exists for_sale boolean not null default false;
alter table tools add column if not exists asking_price numeric;

grant select (for_sale) on tools to anon, authenticated;
-- asking_price intentionally NOT granted — only reachable via get_asking_price().

create or replace function get_asking_price(p_tool_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_price numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select crib_id, asking_price into v_owner_id, v_price from tools where id = p_tool_id;
  if v_owner_id is null then
    raise exception 'Tool not found';
  end if;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can view the asking price';
  end if;

  return v_price;
end;
$$;

revoke execute on function get_asking_price(uuid) from public;
grant execute on function get_asking_price(uuid) to authenticated;
