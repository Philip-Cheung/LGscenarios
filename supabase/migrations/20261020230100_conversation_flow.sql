-- Conversation scenarios (content schema 3.0): readiness, the knock/open
-- encounter, and a spoken conversation with a shared, ordered history.
--
-- Session state for a 3.0 session
--   * Readiness (stage `paired` or `scene_setup`): each player calls set_ready.
--     When both are ready the missionary starts the encounter.
--   * Encounter (stage `encounter`): `knock` (missionary acts) then `open`
--     (Christian acts). Each action has a five second server deadline unless
--     relaxed timing is on. A missed deadline never ends the pair; the player
--     who acts can retry, with or without the timer.
--   * Conversation (stage `conversation`): `turn` says who speaks next.
--     commit_utterance appends one authored beat (missionary) or one response
--     (Christian) to `history` and hands the turn over, in one transaction.
--     Committing the closing line completes the round.
--   * Restart and an accepted role swap start a new round, which clears the
--     encounter, history, and turn.
--
-- Trust
--   * Beat ids, follow-up rules, and suggested-response counts come from the
--     pinned registry content; callers send only an id.
--   * History stores ids and response kinds, never transcripts or free text.
--   * Every command checks role, round, expected revision, and pending
--     requests. A repeated command id returns the state it produced.
--
-- 2.x sessions keep using guided_event; these RPCs refuse them, and
-- guided_event already refuses 3.0 content.

-- ---------------------------------------------------------------------------
-- Registry: accept 3.0 content, which lists topics instead of questions.
-- ---------------------------------------------------------------------------
alter table public.scenario_registry drop constraint scenario_registry_content_identity;
alter table public.scenario_registry
  add constraint scenario_registry_content_identity
    check (
      content is null
      or (
        jsonb_typeof(content) = 'object'
        and content ->> 'id' = scenario_id
        and content -> 'version' = to_jsonb(version)
        and (
          (content ->> 'schemaVersion' in ('1.0', '2.0', '2.1') and jsonb_typeof(content -> 'questions') = 'array')
          or (content ->> 'schemaVersion' = '3.0' and jsonb_typeof(content -> 'topics') = 'array')
        )
      )
    );

-- ---------------------------------------------------------------------------
-- Sessions: encounter and conversation state.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column turn text not null default 'missionary',
  add column history jsonb not null default '[]'::jsonb,
  add column encounter_phase text,
  add column encounter_deadline timestamptz,
  add column encounter_relaxed boolean not null default false,
  add column last_command_id uuid;

alter table public.sessions drop constraint sessions_stage_check;
alter table public.sessions
  add constraint sessions_stage_check
    check (stage in (
      'paired', 'scene_setup', 'ready_together', 'opening_dialogue', 'question_selection', 'response', 'closing',
      'encounter', 'conversation', 'conclusion'
    )),
  add constraint sessions_turn_check check (turn in ('missionary', 'christian')),
  add constraint sessions_history_shape check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 100),
  add constraint sessions_encounter_phase_check check (encounter_phase is null or encounter_phase in ('knock', 'open')),
  add constraint sessions_encounter_has_phase check ((stage = 'encounter') = (encounter_phase is not null)),
  add constraint sessions_deadline_needs_phase check (encounter_deadline is null or encounter_phase is not null);

-- A new round (restart or role swap) clears all round state.
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
    new.turn := 'missionary';
    new.history := '[]'::jsonb;
    new.encounter_phase := null;
    new.encounter_deadline := null;
    new.encounter_relaxed := false;
    new.last_command_id := null;
  elsif old.active_question_id is not null
     and new.active_question_id is null
     and new.stage = 'question_selection'
     and not (old.active_question_id = any(old.answered_question_ids)) then
    new.answered_question_ids := array_append(old.answered_question_ids, old.active_question_id);
  end if;
  return new;
end;
$$;

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
    'swap_pending', p_session.swap_requested_by is not null
      and p_session.swap_requested_at > now() - interval '60 seconds',
    'swap_by_me', p_session.swap_requested_by is not distinct from p_viewer,
    'swap_requested_at', case when p_session.swap_requested_by is not null then p_session.swap_requested_at end,
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

-- ---------------------------------------------------------------------------
-- Content helpers for 3.0 scenarios.
-- ---------------------------------------------------------------------------

-- The authored beat with this id: the opening, a topic question, a follow-up,
-- the clarification, or the closing.
create function app_private.conversation_beat(p_content jsonb, p_id text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case when p_content #>> '{opening,id}' = p_id then p_content -> 'opening' end,
    case when p_content #>> '{clarification,id}' = p_id then p_content -> 'clarification' end,
    case when p_content #>> '{closing,id}' = p_id then p_content -> 'closing' end,
    (select t -> 'question' from jsonb_array_elements(p_content -> 'topics') t
      where t #>> '{question,id}' = p_id limit 1),
    (select f from jsonb_array_elements(p_content -> 'topics') t, jsonb_array_elements(t -> 'followUps') f
      where f ->> 'id' = p_id limit 1)
  )
$$;

-- The topic a question or follow-up belongs to; null for other beats.
create function app_private.conversation_topic(p_content jsonb, p_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select t ->> 'id'
  from jsonb_array_elements(p_content -> 'topics') t
  where t #>> '{question,id}' = p_id
     or exists (select 1 from jsonb_array_elements(t -> 'followUps') f where f ->> 'id' = p_id)
  limit 1
$$;

-- Shared checks for the conversation commands, on a session row the caller
-- has already locked. Returns an error result, or null to proceed.
create function app_private.conversation_guard(p_session public.sessions, p_uid uuid, p_expected_revision bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_content jsonb;
begin
  if p_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(p_session, p_uid));
  end if;
  if p_session.status not in ('ready', 'active')
     or p_session.christian_user_id is null
     or p_session.restart_requested_by is not null
     or p_session.swap_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(p_session, p_uid));
  end if;
  select r.content into v_content
  from public.scenario_registry r
  where r.scenario_id = p_session.scenario_id and r.version = p_session.scenario_version;
  if v_content is null or v_content ->> 'schemaVersion' <> '3.0' then
    return app_private.fail('invalid_state', app_private.session_state(p_session, p_uid));
  end if;
  if not app_private.is_fresh(p_session.id, app_private.partner_of(p_session, p_uid)) then
    return app_private.fail('partner_stale', app_private.session_state(p_session, p_uid));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Readiness.
-- ---------------------------------------------------------------------------
create function public.set_ready(p_session_id uuid, p_relaxed boolean, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.sessions;
  v_role text;
  v_failure jsonb;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_relaxed is null or p_expected_revision is null then
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
  if v_session.stage in ('paired', 'scene_setup')
     and ((v_role = 'missionary' and v_session.missionary_ready) or (v_role = 'christian' and v_session.christian_ready)) then
    return app_private.ok(app_private.session_state(v_session, v_uid));
  end if;

  v_failure := app_private.conversation_guard(v_session, v_uid, p_expected_revision);
  if v_failure is not null then
    return v_failure;
  end if;
  if v_session.stage not in ('paired', 'scene_setup') then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set missionary_ready = s.missionary_ready or v_role = 'missionary',
      christian_ready = s.christian_ready or v_role = 'christian',
      encounter_relaxed = s.encounter_relaxed or p_relaxed,
      stage = 'scene_setup',
      status = case
        when (s.missionary_ready or v_role = 'missionary') and (s.christian_ready or v_role = 'christian') then 'active'
        else s.status
      end,
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- The knock/open encounter.
-- ---------------------------------------------------------------------------
create function public.perform_encounter_action(
  p_session_id uuid,
  p_action text,
  p_relaxed boolean,
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
  v_failure jsonb;
  v_relaxed boolean;
  -- The action window, plus allowance for the tap to reach the server.
  v_window constant interval := interval '5 seconds';
  v_grace constant interval := interval '1 second';
  -- The knock plays for this long before the Christian's window opens.
  v_knock_animation constant interval := interval '1300 milliseconds';
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_action is null or p_action not in ('start', 'knock', 'open', 'retry')
     or p_relaxed is null or p_expected_revision is null then
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

  v_failure := app_private.conversation_guard(v_session, v_uid, p_expected_revision);
  if v_failure is not null then
    return v_failure;
  end if;

  -- The missionary starts and knocks; the Christian opens. Whoever acts in
  -- the current phase may retry it.
  if (p_action in ('start', 'knock') and v_role <> 'missionary')
     or (p_action = 'open' and v_role <> 'christian')
     or (p_action = 'retry' and v_role <> case when v_session.encounter_phase = 'open' then 'christian' else 'missionary' end) then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;

  v_relaxed := v_session.encounter_relaxed or p_relaxed;

  case p_action
    when 'start' then
      if v_session.stage not in ('paired', 'scene_setup')
         or not v_session.missionary_ready
         or not v_session.christian_ready then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'encounter',
          encounter_phase = 'knock',
          encounter_relaxed = v_relaxed,
          encounter_deadline = case when v_relaxed then null else now() + v_window end,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'knock', 'open' then
      if v_session.stage <> 'encounter' or v_session.encounter_phase <> p_action then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      if v_session.encounter_deadline is not null and now() > v_session.encounter_deadline + v_grace then
        return app_private.fail('deadline_passed', app_private.session_state(v_session, v_uid));
      end if;
      if p_action = 'knock' then
        update public.sessions s
        set encounter_phase = 'open',
            encounter_deadline = case when s.encounter_relaxed then null else now() + v_knock_animation + v_window end,
            revision = s.revision + 1,
            updated_at = now()
        where s.id = v_session.id
        returning * into v_session;
      else
        update public.sessions s
        set stage = 'conversation',
            encounter_phase = null,
            encounter_deadline = null,
            turn = 'missionary',
            history = '[]'::jsonb,
            revision = s.revision + 1,
            updated_at = now()
        where s.id = v_session.id
        returning * into v_session;
      end if;

    when 'retry' then
      if v_session.stage <> 'encounter' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      -- Only a missed window can be restarted, unless the player turns the
      -- timer off. The grace allows for a phone clock slightly ahead of ours.
      if not (v_relaxed and not v_session.encounter_relaxed)
         and (v_session.encounter_deadline is null or now() < v_session.encounter_deadline - v_grace) then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set encounter_relaxed = v_relaxed,
          encounter_deadline = case when v_relaxed then null else now() + v_window end,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;
  end case;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- Speaking aloud: one committed line per turn.
-- ---------------------------------------------------------------------------
create function public.commit_utterance(
  p_session_id uuid,
  p_round integer,
  p_item_id text,
  p_command_id uuid,
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
  v_failure jsonb;
  v_content jsonb;
  v_spoken text[];
  v_last text;
  v_active_topic text;
  v_beat jsonb;
  v_answer integer;
  v_valid boolean;
  -- History has room for this many lines; the closing line always fits.
  v_history_limit constant integer := 98;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_round is null or p_command_id is null or p_expected_revision is null
     or p_item_id is null or length(p_item_id) > 40 or p_item_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
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

  -- A retried command that already committed returns the state it produced.
  if v_session.last_command_id = p_command_id then
    return app_private.ok(app_private.session_state(v_session, v_uid));
  end if;
  if v_session.round <> p_round then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;

  v_failure := app_private.conversation_guard(v_session, v_uid, p_expected_revision);
  if v_failure is not null then
    return v_failure;
  end if;
  v_role := case when v_uid = v_session.missionary_user_id then 'missionary' else 'christian' end;
  if v_session.stage <> 'conversation' or v_session.status <> 'active' or v_session.turn <> v_role then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  select r.content into v_content
  from public.scenario_registry r
  where r.scenario_id = v_session.scenario_id and r.version = v_session.scenario_version;

  select coalesce(array_agg(e ->> 'id' order by n), '{}') into v_spoken
  from jsonb_array_elements(v_session.history) with ordinality as h(e, n)
  where e ->> 'speaker' = 'missionary';
  v_last := v_spoken[cardinality(v_spoken)];

  if v_role = 'missionary' then
    -- The active topic is the topic of the most recent question or follow-up;
    -- a clarification keeps it.
    select app_private.conversation_topic(v_content, id) into v_active_topic
    from unnest(v_spoken) with ordinality as spoken(id, n)
    where app_private.conversation_topic(v_content, id) is not null
    order by n desc
    limit 1;

    if cardinality(v_spoken) = 0 then
      v_valid := p_item_id = v_content #>> '{opening,id}';
    elsif p_item_id = v_content #>> '{closing,id}' then
      v_valid := true;
    elsif jsonb_array_length(v_session.history) >= v_history_limit then
      v_valid := false;
    elsif p_item_id = v_content #>> '{clarification,id}' then
      v_valid := v_active_topic is not null and v_last <> p_item_id;
    elsif p_item_id = any(v_spoken) then
      v_valid := false;
    elsif exists (select 1 from jsonb_array_elements(v_content -> 'topics') t where t #>> '{question,id}' = p_item_id) then
      v_valid := true;
    else
      v_valid := app_private.conversation_topic(v_content, p_item_id) is not distinct from v_active_topic
        and v_active_topic is not null
        and app_private.conversation_beat(v_content, p_item_id) is not null;
    end if;
    if not v_valid then
      return app_private.fail('invalid_input', app_private.session_state(v_session, v_uid));
    end if;

    if p_item_id = v_content #>> '{closing,id}' then
      update public.sessions s
      set history = s.history || jsonb_build_array(jsonb_build_object('speaker', 'missionary', 'id', p_item_id)),
          stage = 'conclusion',
          status = 'completed',
          last_command_id = p_command_id,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;
    else
      update public.sessions s
      set history = s.history || jsonb_build_array(jsonb_build_object('speaker', 'missionary', 'id', p_item_id)),
          turn = 'christian',
          last_command_id = p_command_id,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;
    end if;
  else
    -- The Christian answers the line just spoken: freely, with one of its
    -- suggested replies, its clarifying question, or "not sure".
    v_beat := app_private.conversation_beat(v_content, v_last);
    if v_beat is null then
      return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
    end if;
    if p_item_id = 'free' then
      v_valid := true;
    elsif p_item_id ~ '^answer-[1-9]$' then
      v_answer := substring(p_item_id from 8)::integer;
      v_valid := v_answer <= jsonb_array_length(coalesce(v_beat #> '{help,answers}', '[]'::jsonb));
    elsif p_item_id = 'clarify' then
      v_valid := v_beat #> '{help,clarify}' is not null;
    elsif p_item_id = 'not-sure' then
      v_valid := v_last <> v_content #>> '{opening,id}';
    else
      v_valid := false;
    end if;
    if not v_valid then
      return app_private.fail('invalid_input', app_private.session_state(v_session, v_uid));
    end if;

    update public.sessions s
    set history = s.history || jsonb_build_array(jsonb_build_object('speaker', 'christian', 'id', p_item_id)),
        turn = 'missionary',
        last_command_id = p_command_id,
        revision = s.revision + 1,
        updated_at = now()
    where s.id = v_session.id
    returning * into v_session;
  end if;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution grants.
-- ---------------------------------------------------------------------------
revoke all on function app_private.track_answered_questions() from public, anon, authenticated;
revoke all on function app_private.session_state(public.sessions, uuid) from public, anon, authenticated;
revoke all on function app_private.conversation_beat(jsonb, text) from public, anon, authenticated;
revoke all on function app_private.conversation_topic(jsonb, text) from public, anon, authenticated;
revoke all on function app_private.conversation_guard(public.sessions, uuid, bigint) from public, anon, authenticated;
revoke all on function public.set_ready(uuid, boolean, bigint) from public, anon, authenticated;
revoke all on function public.perform_encounter_action(uuid, text, boolean, bigint) from public, anon, authenticated;
revoke all on function public.commit_utterance(uuid, integer, text, uuid, bigint) from public, anon, authenticated;

grant execute on function public.set_ready(uuid, boolean, bigint) to authenticated;
grant execute on function public.perform_encounter_action(uuid, text, boolean, bigint) to authenticated;
grant execute on function public.commit_utterance(uuid, integer, text, uuid, bigint) to authenticated;
