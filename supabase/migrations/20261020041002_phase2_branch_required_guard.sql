-- Doorstep Practice: a conditional prompt cannot be left before a choice.
--
-- `selected_branch_id = any(...)` is NULL when nothing is selected, and
-- `not NULL` is NULL, which the earlier guard treated as satisfied. A missing
-- choice now counts as not chosen.

create function app_private.branch_chosen(
  p_scenario_id text,
  p_version integer,
  p_prompt_index integer,
  p_selected text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_selected = any(app_private.allowed_branches(p_scenario_id, p_version, p_prompt_index)),
    false
  )
$$;

revoke all on function app_private.branch_chosen(text, integer, integer, text) from public, anon, authenticated;

create or replace function public.navigate(p_session_id uuid, p_direction text, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
  v_prompt_count integer;
  v_next_index integer;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_direction is null or p_direction not in ('back', 'next') or p_expected_revision is null then
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

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'active' or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;
  if not app_private.is_fresh(v_session.id, v_session.christian_user_id) then
    return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
  end if;

  select r.prompt_count into v_prompt_count
  from public.scenario_registry r
  where r.scenario_id = v_session.scenario_id and r.version = v_session.scenario_version;

  v_next_index := v_session.prompt_index + case when p_direction = 'next' then 1 else -1 end;
  if v_next_index < 0 or v_next_index >= v_prompt_count then
    return app_private.fail('out_of_range', app_private.session_state(v_session, v_uid));
  end if;
  if p_direction = 'next'
     and app_private.prompt_requires_branch(v_session.scenario_id, v_session.scenario_version, v_session.prompt_index)
     and not app_private.branch_chosen(v_session.scenario_id, v_session.scenario_version, v_session.prompt_index, v_session.selected_branch_id) then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set prompt_index = v_next_index,
      selected_branch_id = null,
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create or replace function public.finish_pair(p_session_id uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
  v_prompt_count integer;
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

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'active' or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  select r.prompt_count into v_prompt_count
  from public.scenario_registry r
  where r.scenario_id = v_session.scenario_id and r.version = v_session.scenario_version;

  if v_session.prompt_index <> v_prompt_count - 1 then
    return app_private.fail('out_of_range', app_private.session_state(v_session, v_uid));
  end if;
  if app_private.prompt_requires_branch(v_session.scenario_id, v_session.scenario_version, v_session.prompt_index)
     and not app_private.branch_chosen(v_session.scenario_id, v_session.scenario_version, v_session.prompt_index, v_session.selected_branch_id) then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;
  if not app_private.is_fresh(v_session.id, v_session.christian_user_id) then
    return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set status = 'completed',
      selected_branch_id = null,
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;
