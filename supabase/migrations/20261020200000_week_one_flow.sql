-- Week One flow (scenario schema 2.1): an opening question and topic follow-ups.
--
--   * opening_question_asked: the missionary has asked the opening question;
--     the Christian answers it before the topic list opens. Scenarios without
--     an opening question keep the single opening_complete step.
--   * exchange: whether the current topic is on its initial question or its
--     follow-up. After the Christian answers a topic that has a follow-up, the
--     topic stays active in question_selection with exchange = 'follow_up'; the
--     missionary then asks the follow-up (ask_follow_up) or skips it (next_topic).
--   * A topic counts as answered when it stops being active while the pair is
--     back at the topic list: after the last answer or a skipped follow-up.
--     Moving to closing mid-topic does not mark it answered.
--   * A new round (restart or role swap) resets all of it.

alter table public.sessions
  add column opening_question_asked boolean not null default false,
  add column exchange text not null default 'initial',
  add constraint sessions_exchange_check check (exchange in ('initial', 'follow_up'));

create or replace function app_private.track_answered_questions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.round <> old.round then
    new.answered_question_ids := '{}';
    new.opening_question_asked := false;
    new.exchange := 'initial';
  elsif old.active_question_id is not null
     and new.active_question_id is null
     and new.stage = 'question_selection'
     and not (old.active_question_id = any(old.answered_question_ids)) then
    new.answered_question_ids := array_append(old.answered_question_ids, old.active_question_id);
  end if;
  return new;
end;
$$;

revoke all on function app_private.track_answered_questions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Participant view.
-- ---------------------------------------------------------------------------
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
    'swap_pending', p_session.swap_requested_by is not null,
    'restart_pending', p_session.restart_requested_at is not null
      and p_session.restart_requested_at > now() - interval '60 seconds',
    'restart_by_me', p_session.restart_requested_by is not distinct from p_viewer,
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
    'answered_question_ids', to_jsonb(p_session.answered_question_ids),
    'opening_question_asked', p_session.opening_question_asked,
    'exchange', p_session.exchange,
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
  v_has_opening_question boolean;
  v_has_follow_up boolean;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_event is null
     or p_expected_revision is null
     or p_event not in (
       'start_practice', 'ready', 'begin', 'opening_complete', 'ask_opening_question', 'ask_question',
       'share_complete', 'ask_follow_up', 'next_topic', 'move_to_closing', 'finish'
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
  if v_content is null or v_content ->> 'schemaVersion' not in ('2.0', '2.1') then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;
  v_has_opening_question := (v_content -> 'openingDialogue') ? 'question';

  -- The creator starts the practice; both mark Ready; only the Christian ends
  -- their response; the missionary drives every other step.
  if (p_event = 'start_practice' and v_uid <> v_session.creator_user_id)
     or (p_event = 'share_complete' and v_role <> 'christian')
     or (p_event not in ('start_practice', 'ready', 'share_complete') and v_role <> 'missionary') then
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
      if v_session.stage <> 'opening_dialogue' or v_has_opening_question then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'question_selection', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'ask_opening_question' then
      if v_session.stage <> 'opening_dialogue' or not v_has_opening_question or v_session.opening_question_asked then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set opening_question_asked = true, revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'ask_question' then
      if v_session.stage <> 'question_selection' or v_session.active_question_id is not null then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_content -> 'questions') q where q ->> 'id' = p_target_id
      ) then
        return app_private.fail('invalid_input', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'response', active_question_id = p_target_id, exchange = 'initial',
          revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'share_complete' then
      if v_session.stage = 'opening_dialogue' then
        if not v_session.opening_question_asked then
          return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
        end if;
        update public.sessions s
        set stage = 'question_selection', revision = s.revision + 1, updated_at = now()
        where s.id = v_session.id
        returning * into v_session;
      elsif v_session.stage = 'response' then
        v_has_follow_up := v_session.exchange = 'initial' and exists (
          select 1 from jsonb_array_elements(v_content -> 'questions') q
          where q ->> 'id' = v_session.active_question_id and q ? 'followUp'
        );
        update public.sessions s
        set stage = 'question_selection',
            active_question_id = case when v_has_follow_up then s.active_question_id end,
            exchange = case when v_has_follow_up then 'follow_up' else 'initial' end,
            revision = s.revision + 1,
            updated_at = now()
        where s.id = v_session.id
        returning * into v_session;
      else
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;

    when 'ask_follow_up' then
      if v_session.stage <> 'question_selection'
         or v_session.active_question_id is null
         or v_session.exchange <> 'follow_up' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'response', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'next_topic' then
      if v_session.stage <> 'question_selection'
         or v_session.active_question_id is null
         or v_session.exchange <> 'follow_up' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set active_question_id = null, exchange = 'initial', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'move_to_closing' then
      if v_session.stage <> 'question_selection' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'closing', active_question_id = null, exchange = 'initial',
          revision = s.revision + 1, updated_at = now()
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
