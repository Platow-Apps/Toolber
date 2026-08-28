-- Nudges both sides when a borrowed tool is past its agreed return date.
--
-- 0024 gave every live loan a due_at but nothing ever looked at it, so an
-- overdue tool was only visible to someone who happened to open the app and
-- notice the red text. This adds the scheduled sweep that chases it.
--
-- CADENCE: the first reminder goes out on the first sweep after a loan goes
-- overdue, then repeats every 3 days for as long as it stays out. Daily
-- would be nagging for something the borrower may already be dealing with,
-- and a single one-off reminder is too easy to miss entirely.
--
-- BOTH PARTIES are told, with different copy. The borrower needs to know
-- they are late; the lender needs to know their tool has not come back and
-- that chasing it is now on their radar. Both are gated by the recipient's
-- own borrower_reminders preference in the notify Edge Function.
--
-- Safe to paste and re-run from the top: ADD COLUMN uses IF NOT EXISTS, the
-- function is CREATE OR REPLACE, and the cron job is unscheduled before
-- being rescheduled.

alter table borrow_requests add column if not exists overdue_reminded_at timestamptz;

-- Every sweep filters on exactly this shape.
create index if not exists borrow_requests_overdue_idx
  on borrow_requests (due_at)
  where status = 'approved';

create or replace function send_overdue_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent integer := 0;
  v_req record;
begin
  for v_req in
    select br.id, br.tool_id, br.borrower_id, br.lender_id, br.due_at,
           greatest(1, (extract(epoch from now() - br.due_at) / 86400)::integer) as days_late
    from borrow_requests br
    where br.status = 'approved'
      and br.due_at is not null
      and br.due_at < now()
      and (br.overdue_reminded_at is null or br.overdue_reminded_at < now() - interval '3 days')
  loop
    insert into notifications (profile_id, type, payload)
    values (
      v_req.borrower_id, 'borrow_overdue',
      jsonb_build_object('request_id', v_req.id, 'tool_id', v_req.tool_id,
                         'due_at', v_req.due_at, 'days_late', v_req.days_late)
    );

    insert into notifications (profile_id, type, payload)
    values (
      v_req.lender_id, 'borrow_overdue_lender',
      jsonb_build_object('request_id', v_req.id, 'tool_id', v_req.tool_id,
                         'due_at', v_req.due_at, 'days_late', v_req.days_late)
    );

    update borrow_requests set overdue_reminded_at = now() where id = v_req.id;
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

-- Internal: run by the scheduler, never called from the client.
revoke execute on function send_overdue_reminders() from public;

-- ============================================================
-- Schedule
-- ============================================================
-- 17:00 UTC daily -- late morning in US Pacific, so a reminder lands during
-- the day rather than overnight. The sweep is idempotent within its own
-- window (overdue_reminded_at gates repeats), so a missed or doubled run
-- cannot double-notify.
--
-- Wrapped in a guard because pg_cron may not be enabled on the project. If
-- this raises the NOTICE below, enable it under Database -> Extensions in
-- the Supabase dashboard and re-run this file; everything else here will
-- already have applied.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'toolber-overdue-reminders') then
      perform cron.unschedule('toolber-overdue-reminders');
    end if;
    perform cron.schedule(
      'toolber-overdue-reminders',
      '0 17 * * *',
      $cron$select send_overdue_reminders()$cron$
    );
    raise notice 'Scheduled toolber-overdue-reminders (daily, 17:00 UTC).';
  else
    raise notice 'pg_cron is NOT enabled -- overdue reminders will not run. Enable pg_cron under Database -> Extensions, then re-run this migration.';
  end if;
end;
$$;
