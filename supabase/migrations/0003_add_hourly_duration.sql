-- Adds "hour" as a price_duration_unit option, per user request — the
-- previous set (half_day/day/week/month) didn't cover short-duration
-- rentals. Placed before half_day so it reads in ascending order.
--
-- Note: ALTER TYPE ... ADD VALUE must run as its own statement, not
-- batched with other DDL in the same transaction block — run this file
-- alone in the SQL Editor, same as the others.

alter type price_duration_unit add value 'hour' before 'half_day';
