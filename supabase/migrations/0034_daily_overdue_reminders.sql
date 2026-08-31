-- Overdue reminders go out daily, not every third day.
--
-- 0025 chose 3 days on the reasoning that a daily nudge would nag someone
-- who is already sorting it out. The owner's call is the opposite: an
-- unreturned tool is the one thing in this app where being a bit annoying is
-- the point, and the terms now promise daily.
--
-- The sweep itself already runs once a day, so this only widens which loans
-- it picks up on each pass. overdue_reminded_at still gates repeats, so a
-- doubled cron run cannot double-notify.
--
-- Safe to paste and re-run from the top.

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
      -- Daily: anything not reminded within the last 20 hours is due another
      -- nudge. 20 rather than 24 so a sweep that runs a few minutes late
      -- doesn't skip a day entirely.
      and (br.overdue_reminded_at is null or br.overdue_reminded_at < now() - interval '20 hours')
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

revoke execute on function send_overdue_reminders() from public;
