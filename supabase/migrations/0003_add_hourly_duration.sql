-- Adds "hour" as a price_duration_unit option, per user request — the
-- previous set (half_day/day/week/month) didn't cover short-duration
-- rentals. Placed before half_day so it reads in ascending order.
--
-- The note that used to be here said ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction block, so this file had to be pasted into the SQL
-- Editor on its own. That was true before PostgreSQL 12 and has not been
-- since: the value may be added in a transaction, it simply cannot be *used*
-- until that transaction commits, and this file only adds it. The restriction
-- mattered, because `supabase db push` and `supabase db reset` both run each
-- migration transactionally — if it still held, neither would work at all.
-- Verified 2026-09-20: all 65 migrations apply cleanly through `db reset`, and
-- CI's `database` job does the same on every push (audit §9).

alter type price_duration_unit add value 'hour' before 'half_day';
