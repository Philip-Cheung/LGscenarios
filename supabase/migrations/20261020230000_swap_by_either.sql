-- Role swap works like restart: either participant asks, the other accepts or
-- declines, the requester can cancel, and an unanswered request expires after
-- 60 seconds. A swap may be asked for during a round as well as after it.
-- Accepting still swaps the seats and starts a new round at the pairing step.

alter table public.sessions add column swap_requested_at timestamptz;

update public.sessions set swap_requested_at = now() where swap_requested_by is not null;

alter table public.sessions drop constraint sessions_swap_by_missionary;
alter table public.sessions add constraint sessions_swap_by_participant
  check (
    swap_requested_by is null
    or swap_requested_by = missionary_user_id
    or swap_requested_by = christian_user_id
  );
alter table public.sessions add constraint sessions_swap_has_time
  check (swap_requested_by is null or swap_requested_at is not null);

-- Clears an unanswered restart or swap request once its 60 seconds are up.
create or replace function app_private.clear_expired_restart(p_session public.sessions)
returns public.sessions
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_session public.sessions := p_session;
begin
  if (p_session.restart_requested_at is not null
      and p_session.restart_requested_at <= now() - interval '60 seconds')
     or (p_session.swap_requested_by is not null
      and p_session.swap_requested_at <= now() - interval '60 seconds') then
    update public.sessions s
      set restart_requested_by = case
            when s.restart_requested_at <= now() - interval '60 seconds' then null
            else s.restart_requested_by
          end,
          restart_requested_at = case
            when s.restart_requested_at <= now() - interval '60 seconds' then null
            else s.restart_requested_at
          end,
          swap_requested_by = case
            when s.swap_requested_at <= now() - interval '60 seconds' then null
            else s.swap_requested_by
          end,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = p_session.id
        and (
          (s.restart_requested_at is not null and s.restart_requested_at <= now() - interval '60 seconds')
          or (s.swap_requested_by is not null and s.swap_requested_at <= now() - interval '60 seconds')
        )
      returning * into v_session;
    if not found then
      select * into v_session from public.sessions s where s.id = p_session.id;
    end if;
  end if;
  return v_session;
end;
$$;

create or replace function public.request_swap(p_session_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_expected_revision is null then
    return app_private.fail('invalid_input');
  end if;

  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found or not app_private.is_participant(v_session, v_uid) then
    return app_private.fail('not_found');
  end if;
  if v_session.expires_at <= now() then
    return app_private.fail('session_expired');
  end if;
  v_session := app_private.clear_expired_restart(v_session);
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status not in ('active', 'completed')
     or v_session.christian_user_id is null
     or v_session.swap_requested_by is not null
     or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set swap_requested_by = v_uid,
      swap_requested_at = now(),
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create or replace function public.respond_swap(p_session_id uuid, p_accept boolean, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_accept is null or p_expected_revision is null then
    return app_private.fail('invalid_input');
  end if;

  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found or not app_private.is_participant(v_session, v_uid) then
    return app_private.fail('not_found');
  end if;
  if v_session.expires_at <= now() then
    return app_private.fail('session_expired');
  end if;
  v_session := app_private.clear_expired_restart(v_session);
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.swap_requested_by = v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.swap_requested_by is null
     or v_session.status not in ('active', 'completed')
     or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  if p_accept then
    if not app_private.is_fresh(v_session.id, v_session.swap_requested_by) then
      return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
    end if;
    update public.sessions s
    set missionary_user_id = s.christian_user_id,
        christian_user_id = s.missionary_user_id,
        swap_requested_by = null,
        swap_requested_at = null,
        restart_requested_by = null,
        restart_requested_at = null,
        selected_branch_id = null,
        round = s.round + 1,
        prompt_index = 0,
        status = 'ready',
        stage = 'paired',
        missionary_ready = false,
        christian_ready = false,
        active_question_id = null,
        revision = s.revision + 1,
        updated_at = now()
    where s.id = v_session.id
    returning * into v_session;
  else
    update public.sessions s
    set swap_requested_by = null, swap_requested_at = null, revision = s.revision + 1, updated_at = now()
    where s.id = v_session.id
    returning * into v_session;
  end if;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.cancel_swap(p_session_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_expected_revision is null then
    return app_private.fail('invalid_input');
  end if;

  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found or not app_private.is_participant(v_session, v_uid) then
    return app_private.fail('not_found');
  end if;
  if v_session.expires_at <= now() then
    return app_private.fail('session_expired');
  end if;
  v_session := app_private.clear_expired_restart(v_session);
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.swap_requested_by is distinct from v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set swap_requested_by = null, swap_requested_at = null, revision = s.revision + 1, updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

revoke all on function app_private.clear_expired_restart(public.sessions) from public, anon, authenticated;
revoke all on function public.request_swap(uuid, bigint) from public, anon, authenticated;
revoke all on function public.respond_swap(uuid, boolean, bigint) from public, anon, authenticated;
revoke all on function public.cancel_swap(uuid, bigint) from public, anon, authenticated;
grant execute on function public.request_swap(uuid, bigint) to authenticated;
grant execute on function public.respond_swap(uuid, boolean, bigint) to authenticated;
grant execute on function public.cancel_swap(uuid, bigint) to authenticated;
