-- Two-sided conversations (content schema 3.1): the missionary replies to
-- what the Christian said before choosing what to ask next.
--
-- In a 3.1 session, once the Christian answers a question or follow-up whose
-- content has reply support (`respond`), the missionary is responding to that
-- line. They may commit:
--   * one of that line's authored replies. A reply marked `continue` keeps the
--     turn, and the missionary then chooses what to ask next as before; one
--     marked `christian-response` hands the turn to the Christian;
--   * `free`: they replied in their own words (keeps the turn);
--   * the clarification, unless they just asked it. It hands the turn over,
--     and after the Christian's answer the missionary responds to the same
--     line again;
--   * the closing.
-- The Christian answers 3.1 lines with their answers' authored ids instead of
-- positional `answer-N` ids. History still stores ids only, and restart or a
-- role swap clears it, so a new round never inherits a pending reply.
--
-- 3.0 sessions behave exactly as before: their content has no `respond` and
-- no answer ids, so none of the new branches apply.

-- ---------------------------------------------------------------------------
-- Registry: accept 3.1 content.
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
          or (content ->> 'schemaVersion' in ('3.0', '3.1') and jsonb_typeof(content -> 'topics') = 'array')
        )
      )
    );

-- ---------------------------------------------------------------------------
-- Content helpers.
-- ---------------------------------------------------------------------------

-- The authored line with this id: the opening, a topic question, a follow-up,
-- the clarification, the closing, or (3.1) a missionary reply.
create or replace function app_private.conversation_beat(p_content jsonb, p_id text)
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
      where f ->> 'id' = p_id limit 1),
    (select r
      from jsonb_array_elements(p_content -> 'topics') t,
        jsonb_array_elements(jsonb_build_array(t -> 'question') || coalesce(t -> 'followUps', '[]'::jsonb)) b,
        jsonb_array_elements(coalesce(b #> '{respond,replies}', '[]'::jsonb)) r
      where r ->> 'id' = p_id limit 1)
  )
$$;

-- The question or follow-up the missionary is replying to, or null when they
-- are not replying. After the Christian answers a line with reply support,
-- that line. After they answer the clarification or a reply that asked them
-- something, the most recent question or follow-up before it.
create function app_private.conversation_reply_parent(p_content jsonb, p_history jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer := jsonb_array_length(p_history);
  v_asked text;
  v_parent text;
begin
  if v_count < 2
     or p_history #>> array[(v_count - 1)::text, 'speaker'] <> 'christian'
     or p_history #>> array[(v_count - 2)::text, 'speaker'] <> 'missionary' then
    return null;
  end if;
  v_asked := p_history #>> array[(v_count - 2)::text, 'id'];
  if v_asked = p_content #>> '{opening,id}' then
    return null;
  end if;

  if app_private.conversation_topic(p_content, v_asked) is not null then
    v_parent := v_asked;
  else
    select e ->> 'id' into v_parent
    from jsonb_array_elements(p_history) with ordinality as h(e, n)
    where n < v_count - 1
      and e ->> 'speaker' = 'missionary'
      and app_private.conversation_topic(p_content, e ->> 'id') is not null
    order by n desc
    limit 1;
  end if;

  if v_parent is null or app_private.conversation_beat(p_content, v_parent) -> 'respond' is null then
    return null;
  end if;
  return v_parent;
end;
$$;

-- Shared checks for the conversation commands, on a session row the caller
-- has already locked. Returns an error result, or null to proceed.
create or replace function app_private.conversation_guard(p_session public.sessions, p_uid uuid, p_expected_revision bigint)
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
  if v_content is null or v_content ->> 'schemaVersion' not in ('3.0', '3.1') then
    return app_private.fail('invalid_state', app_private.session_state(p_session, p_uid));
  end if;
  if not app_private.is_fresh(p_session.id, app_private.partner_of(p_session, p_uid)) then
    return app_private.fail('partner_stale', app_private.session_state(p_session, p_uid));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Speaking aloud: one committed line per turn.
-- ---------------------------------------------------------------------------
create or replace function public.commit_utterance(
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
  v_parent text;
  v_reply jsonb;
  v_turn text;
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
    -- a clarification or a reply keeps it.
    select app_private.conversation_topic(v_content, id) into v_active_topic
    from unnest(v_spoken) with ordinality as spoken(id, n)
    where app_private.conversation_topic(v_content, id) is not null
    order by n desc
    limit 1;

    if v_content ->> 'schemaVersion' = '3.1' then
      v_parent := app_private.conversation_reply_parent(v_content, v_session.history);
    end if;
    v_turn := 'christian';

    if cardinality(v_spoken) = 0 then
      v_valid := p_item_id = v_content #>> '{opening,id}';
    elsif p_item_id = v_content #>> '{closing,id}' then
      v_valid := true;
    elsif jsonb_array_length(v_session.history) >= v_history_limit then
      v_valid := false;
    elsif v_parent is not null then
      -- Replying to the Christian's answer.
      if p_item_id = 'free' then
        v_valid := true;
        v_turn := 'missionary';
      elsif p_item_id = v_content #>> '{clarification,id}' then
        v_valid := v_last <> p_item_id;
      else
        select r into v_reply
        from jsonb_array_elements(app_private.conversation_beat(v_content, v_parent) #> '{respond,replies}') r
        where r ->> 'id' = p_item_id;
        v_valid := v_reply is not null;
        if v_reply ->> 'next' = 'continue' then
          v_turn := 'missionary';
        end if;
      end if;
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
          turn = v_turn,
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
      -- Positional ids only name answers that have no id of their own.
      v_answer := substring(p_item_id from 8)::integer;
      v_valid := coalesce(jsonb_typeof(v_beat #> array['help', 'answers', (v_answer - 1)::text]) = 'string', false);
    elsif p_item_id = 'clarify' then
      v_valid := v_beat #> '{help,clarify}' is not null;
    elsif p_item_id = 'not-sure' then
      v_valid := v_last <> v_content #>> '{opening,id}';
    else
      v_valid := exists (
        select 1
        from jsonb_array_elements(coalesce(v_beat #> '{help,answers}', '[]'::jsonb)) a
        where jsonb_typeof(a) = 'object' and a ->> 'id' = p_item_id
      );
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

revoke all on function app_private.conversation_reply_parent(jsonb, jsonb) from public, anon, authenticated;
