-- Warm coach flow: the six-step practice from the design handoff.
--
-- Session state
--   * After pairing, both phones see a "You're paired" summary (stage
--     `paired`). The missionary starts practice, which opens the scene.
--   * scene_setup: each player marks themselves ready; both ready opens
--     ready_together, where the missionary begins the conversation.
--   * opening_dialogue -> question_selection -> response -> question_selection
--     loops once per question. The missionary's choice stays on their phone
--     until "I've asked it" (ask_question), and the Christian ends the response.
--   * The missionary can move to closing from question selection; finishing the
--     closing completes the round.
--   * Restart returns to the scene with roles kept. An accepted role swap
--     returns to the paired summary so both players see their new roles.
--   * The knock/open trigger and follow-ups are removed.
--
-- Scenario content
--   * Version 2.0 content drives this flow. Published 1.0 rows stay readable
--     for history but can no longer be played.

-- ---------------------------------------------------------------------------
-- Registry: accept 2.0 content.
-- ---------------------------------------------------------------------------
alter table public.scenario_registry drop constraint scenario_registry_content_identity;
alter table public.scenario_registry
  add constraint scenario_registry_content_identity
    check (
      content is null
      or (
        jsonb_typeof(content) = 'object'
        and content ->> 'schemaVersion' in ('1.0', '2.0')
        and content ->> 'id' = scenario_id
        and content -> 'version' = to_jsonb(version)
        and jsonb_typeof(content -> 'questions') = 'array'
      )
    );

-- ---------------------------------------------------------------------------
-- Sessions: new stages.
-- ---------------------------------------------------------------------------
alter table public.sessions
  drop constraint sessions_stage_check,
  drop constraint sessions_followup_id_format,
  drop constraint sessions_followup_needs_question,
  drop constraint sessions_discussion_has_question;

-- Sessions in progress land on the nearest new stage.
update public.sessions set stage = 'paired' where status = 'waiting';
update public.sessions set stage = 'ready_together' where stage = 'interaction_trigger';
update public.sessions set stage = 'question_selection', active_question_id = null where stage = 'discussion';

alter table public.sessions
  drop column trigger_initiated,
  drop column active_followup_id,
  drop column question_asked;

alter table public.sessions alter column stage set default 'paired';

alter table public.sessions
  add constraint sessions_stage_check
    check (stage in (
      'paired', 'scene_setup', 'ready_together', 'opening_dialogue', 'question_selection', 'response', 'closing', 'conclusion'
    )),
  add constraint sessions_response_has_question check ((stage = 'response') = (active_question_id is not null));

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
    'my_role', case when p_viewer = p_session.missionary_user_id then 'missionary' else 'christian' end,
    'partner_joined', p_session.christian_user_id is not null,
    'swap_pending', p_session.swap_requested_by is not null,
    'restart_pending', p_session.restart_requested_at is not null
      and p_session.restart_requested_at > now() - interval '60 seconds',
    'restart_requested_at', p_session.restart_requested_at,
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

-- ---------------------------------------------------------------------------
-- Stage transitions.
-- ---------------------------------------------------------------------------
create or replace function public.guided_event(
  p_session_id uuid,
  p_event text,
  p_target_id text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
  v_role text;
  v_content jsonb;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_event is null
     or p_expected_revision is null
     or p_event not in (
       'start_practice', 'ready', 'begin', 'opening_complete', 'ask_question',
       'share_complete', 'move_to_closing', 'finish'
     )
     or (p_event = 'ask_question') <> (p_target_id is not null)
     or (p_target_id is not null and (p_target_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_target_id) > 40)) then
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
  v_role := case when v_uid = v_session.missionary_user_id then 'missionary' else 'christian' end;

  -- A repeated Ready tap is harmless.
  if p_event = 'ready'
     and v_session.stage = 'scene_setup'
     and v_session.status in ('ready', 'active')
     and ((v_role = 'missionary' and v_session.missionary_ready) or (v_role = 'christian' and v_session.christian_ready)) then
    return app_private.ok(app_private.session_state(v_session, v_uid));
  end if;

  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status not in ('ready', 'active')
     or v_session.christian_user_id is null
     or v_session.restart_requested_by is not null
     or v_session.swap_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;
  if not app_private.is_fresh(v_session.id, app_private.partner_of(v_session, v_uid)) then
    return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
  end if;

  select r.content into v_content
  from public.scenario_registry r
  where r.scenario_id = v_session.scenario_id and r.version = v_session.scenario_version;
  if v_content is null or v_content ->> 'schemaVersion' <> '2.0' then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  -- Only the Christian ends their response; the missionary drives every other step except Ready.
  if (p_event = 'share_complete' and v_role <> 'christian')
     or (p_event not in ('ready', 'share_complete') and v_role <> 'missionary') then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;

  case p_event
    when 'start_practice' then
      if v_session.stage <> 'paired' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'scene_setup', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'ready' then
      if v_session.stage <> 'scene_setup' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set missionary_ready = s.missionary_ready or v_role = 'missionary',
          christian_ready = s.christian_ready or v_role = 'christian',
          stage = case
            when (s.missionary_ready or v_role = 'missionary') and (s.christian_ready or v_role = 'christian')
              then 'ready_together'
            else s.stage
          end,
          status = case
            when (s.missionary_ready or v_role = 'missionary') and (s.christian_ready or v_role = 'christian')
              then 'active'
            else s.status
          end,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'begin' then
      if v_session.stage <> 'ready_together' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'opening_dialogue', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'opening_complete' then
      if v_session.stage <> 'opening_dialogue' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'question_selection', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'ask_question' then
      if v_session.stage <> 'question_selection' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_content -> 'questions') q where q ->> 'id' = p_target_id
      ) then
        return app_private.fail('invalid_input', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'response', active_question_id = p_target_id, revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'share_complete' then
      if v_session.stage <> 'response' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'question_selection', active_question_id = null, revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'move_to_closing' then
      if v_session.stage <> 'question_selection' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'closing', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'finish' then
      if v_session.stage <> 'closing' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'conclusion', status = 'completed', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;
  end case;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

revoke all on function public.guided_event(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.guided_event(uuid, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- An accepted swap returns to the paired summary; restart returns to the scene.
-- ---------------------------------------------------------------------------
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

  if v_session.christian_user_id is distinct from v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'completed'
    or v_session.swap_requested_by is distinct from v_session.missionary_user_id
    or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  if p_accept then
    if not app_private.is_fresh(v_session.id, v_session.missionary_user_id) then
      return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
    end if;
    update public.sessions s
    set missionary_user_id = s.christian_user_id,
        christian_user_id = s.missionary_user_id,
        swap_requested_by = null,
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
    set swap_requested_by = null, revision = s.revision + 1, updated_at = now()
    where s.id = v_session.id
    returning * into v_session;
  end if;

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

  if v_session.christian_user_id is distinct from v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.restart_requested_by is distinct from v_session.missionary_user_id
     or v_session.status not in ('active', 'completed') then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  if p_accept then
    if not app_private.is_fresh(v_session.id, v_session.missionary_user_id) then
      return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
    end if;
    update public.sessions s
    set status = 'active',
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
