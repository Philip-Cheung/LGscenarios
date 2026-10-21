-- Hard mode opens straight into the conversation. Each phone plays the Hard
-- mode intro in place of the doorstep encounter, so accepting a Hard mode
-- request skips scene setup, the knock, and the door. A plain restart still
-- returns the pair to scene setup.

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
  v_hard boolean;
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
    v_hard := v_target.scenario_id is not null;
    update public.sessions s
    set scenario_id = coalesce(v_target.scenario_id, s.scenario_id),
        scenario_version = coalesce(v_target.version, s.scenario_version),
        history = case when v_hard then '[]'::jsonb else s.history end,
        turn = case when v_hard then 'missionary' else s.turn end,
        status = 'active',
        prompt_index = 0,
        round = s.round + 1,
        swap_requested_by = null,
        restart_requested_by = null,
        restart_requested_at = null,
        selected_branch_id = null,
        stage = case when v_hard then 'conversation' else 'scene_setup' end,
        missionary_ready = v_hard,
        christian_ready = v_hard,
        encounter_phase = case when v_hard then null else s.encounter_phase end,
        encounter_deadline = case when v_hard then null else s.encounter_deadline end,
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

revoke all on function public.respond_restart(uuid, boolean, bigint) from public, anon, authenticated;
grant execute on function public.respond_restart(uuid, boolean, bigint) to authenticated;
