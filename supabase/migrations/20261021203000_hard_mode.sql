-- Hard mode: from the reflection screen, either participant can ask to move
-- the pair into a harder scenario. It works like a restart request (the
-- partner accepts or declines; an unanswered request expires after 60
-- seconds), but accepting also moves the session to the newest published
-- version of the scenario the finished content names in `hardMode.scenarioId`.
-- Roles are kept; the pair starts again at the pairing step.
--
-- The target is read from the session's pinned content, never from the
-- client. Sessions without a hard mode, and every other request, behave
-- exactly as before.

alter table public.sessions add column restart_hard_mode boolean not null default false;

-- Every path that clears a restart request (answer, cancel, expiry, swap)
-- also clears the hard-mode flag, without rewriting each of them.
create function app_private.clear_hard_mode_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.restart_requested_by is null then
    new.restart_hard_mode := false;
  end if;
  return new;
end;
$$;

revoke all on function app_private.clear_hard_mode_flag() from public, anon, authenticated;

create trigger sessions_clear_hard_mode_flag
before update on public.sessions
for each row execute function app_private.clear_hard_mode_flag();

-- The newest published, active version of the finished scenario's hard mode, if any.
create function app_private.hard_mode_target(p_session public.sessions)
returns public.scenario_registry
language sql
stable
set search_path = ''
as $$
  select target.*
  from public.scenario_registry current
  join public.scenario_registry target
    on target.scenario_id = current.content #>> '{hardMode,scenarioId}'
  where current.scenario_id = p_session.scenario_id
    and current.version = p_session.scenario_version
    and target.status = 'published'
    and target.active_for_new_sessions
    and target.content ->> 'schemaVersion' in ('3.0', '3.1')
  order by target.published_at desc nulls last, target.version desc
  limit 1
$$;

revoke all on function app_private.hard_mode_target(public.sessions) from public, anon, authenticated;

create function public.request_hard_mode(p_session_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
  v_target public.scenario_registry;
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
  -- Only from the reflection screen of a finished conversation.
  if v_session.status <> 'completed'
     or v_session.stage <> 'conclusion'
     or v_session.christian_user_id is null
     or v_session.swap_requested_by is not null
     or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;
  v_target := app_private.hard_mode_target(v_session);
  if v_target.scenario_id is null then
    return app_private.fail('scenario_unavailable', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set restart_requested_by = v_uid,
      restart_requested_at = now(),
      restart_hard_mode = true,
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create or replace function public.respond_restart(p_session_id uuid, p_accept boolean, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
  v_target public.scenario_registry;
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

  if v_session.restart_requested_by = v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.restart_requested_by is null
     or v_session.status not in ('active', 'completed') then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  if p_accept then
    if not app_private.is_fresh(v_session.id, v_session.restart_requested_by) then
      return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
    end if;
    if v_session.restart_hard_mode then
      v_target := app_private.hard_mode_target(v_session);
      if v_target.scenario_id is null then
        return app_private.fail('scenario_unavailable', app_private.session_state(v_session, v_uid));
      end if;
    end if;
    update public.sessions s
    set scenario_id = coalesce(v_target.scenario_id, s.scenario_id),
        scenario_version = coalesce(v_target.version, s.scenario_version),
        history = case when v_target.scenario_id is null then s.history else '[]'::jsonb end,
        turn = case when v_target.scenario_id is null then s.turn else 'missionary' end,
        status = 'active',
        prompt_index = 0,
        round = s.round + 1,
        swap_requested_by = null,
        restart_requested_by = null,
        restart_requested_at = null,
        selected_branch_id = null,
        stage = 'scene_setup',
        missionary_ready = false,
        christian_ready = false,
        active_question_id = null,
        revision = s.revision + 1,
        updated_at = now()
    where s.id = v_session.id
    returning * into v_session;
  else
    update public.sessions s
    set restart_requested_by = null,
        restart_requested_at = null,
        revision = s.revision + 1,
        updated_at = now()
    where s.id = v_session.id
    returning * into v_session;
  end if;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create or replace function app_private.session_state(p_session public.sessions, p_viewer uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_session.id,
    'scenario_id', p_session.scenario_id,
    'scenario_version', p_session.scenario_version,
    'status', case when p_session.expires_at <= now() then 'expired' else p_session.status end,
    'revision', p_session.revision,
    'round', p_session.round,
    'my_role', case
      when p_session.status = 'waiting' then p_session.creator_role
      when p_viewer = p_session.missionary_user_id then 'missionary'
      else 'christian'
    end,
    'is_creator', p_viewer = p_session.creator_user_id,
    'partner_joined', p_session.christian_user_id is not null,
    'swap_pending', p_session.swap_requested_by is not null
      and p_session.swap_requested_at > now() - interval '60 seconds',
    'swap_by_me', p_session.swap_requested_by is not distinct from p_viewer,
    'swap_requested_at', case when p_session.swap_requested_by is not null then p_session.swap_requested_at end,
    'restart_pending', p_session.restart_requested_at is not null
      and p_session.restart_requested_at > now() - interval '60 seconds',
    'restart_by_me', p_session.restart_requested_by is not distinct from p_viewer,
    'restart_requested_at', p_session.restart_requested_at,
    'restart_hard_mode', p_session.restart_hard_mode,
    'stage', p_session.stage,
    'my_ready', case
      when p_viewer = p_session.missionary_user_id then p_session.missionary_ready
      else p_session.christian_ready
    end,
    'partner_ready', case
      when p_viewer = p_session.missionary_user_id then p_session.christian_ready
      else p_session.missionary_ready
    end,
    'active_question_id', p_session.active_question_id,
    'answered_question_ids', to_jsonb(p_session.answered_question_ids),
    'opening_question_asked', p_session.opening_question_asked,
    'exchange', p_session.exchange,
    'turn', p_session.turn,
    'history', p_session.history,
    'encounter_phase', p_session.encounter_phase,
    'encounter_deadline', p_session.encounter_deadline,
    'encounter_relaxed', p_session.encounter_relaxed,
    'server_now', now(),
    'partner_fresh', case
      when p_session.christian_user_id is null then null
      else app_private.is_fresh(p_session.id, app_private.partner_of(p_session, p_viewer))
    end,
    'expires_at', p_session.expires_at,
    'pair_code', case when pc.expires_at > now() then pc.code end,
    'code_expires_at', pc.expires_at
  )
  from (select 1) as one
  left join app_private.pair_codes pc
    on pc.session_id = p_session.id
   and p_viewer = p_session.missionary_user_id
   and p_session.status = 'waiting'
$$;

revoke all on function app_private.session_state(public.sessions, uuid) from public, anon, authenticated;
revoke all on function public.request_hard_mode(uuid, bigint) from public, anon, authenticated;
revoke all on function public.respond_restart(uuid, boolean, bigint) from public, anon, authenticated;

grant execute on function public.request_hard_mode(uuid, bigint) to authenticated;
grant execute on function public.respond_restart(uuid, boolean, bigint) to authenticated;
