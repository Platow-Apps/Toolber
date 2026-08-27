-- notifications had select/update policies for the recipient (0001_init.sql)
-- but no delete policy at all, so there was no way to clear one from the
-- list -- NotificationBell could only ever grow.

create policy notifications_delete_own on notifications for delete to authenticated using (profile_id = auth.uid());
