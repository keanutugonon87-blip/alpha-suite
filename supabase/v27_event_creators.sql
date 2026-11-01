-- Alpha ’28 · v27 · Who can create events in the Attendance tab: the President (Mayor) and the Vice Mayor (Internal and External). No one else.
-- Run v21 and v22 first. Safe to run more than once.
--   Creating, editing, closing, reopening and deleting an event is limited to the Mayor and Vice Mayor.
--   Scanning stays with the Marshals and the other scanning officers. Compiling and the fines report stay with the Secretary.

drop policy if exists events_write on public.v2_events;
create policy events_write on public.v2_events for all to authenticated
  using (public.v2_has_role('mayor', 'vice_mayor')) with check (public.v2_has_role('mayor', 'vice_mayor'));

drop policy if exists escans_delete on public.v2_event_scans;
create policy escans_delete on public.v2_event_scans for delete to authenticated
  using (public.v2_has_role('mayor', 'vice_mayor') or (scanned_by = auth.uid() and public.v2_has_role('secretary', 'marshall', 'sails')));
