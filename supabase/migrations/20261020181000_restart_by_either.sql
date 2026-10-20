-- Either participant may ask to restart, so the request may come from either seat.
alter table public.sessions drop constraint sessions_restart_by_missionary;
alter table public.sessions add constraint sessions_restart_by_participant
  check (
    restart_requested_by is null
    or restart_requested_by = missionary_user_id
    or restart_requested_by = christian_user_id
  );
