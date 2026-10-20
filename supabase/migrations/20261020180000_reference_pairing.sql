-- Reference pairing: either person creates a practice and chooses either role.
--
--   * create_pair takes the creator's role. While waiting, the creator always
--     holds the missionary seat (so pairing codes, regeneration and cleanup
--     work as before) and session_state reports the role they chose. When a
--     partner joins a practice created as the Christian, the seats swap, so
--     after joining missionary_user_id and christian_user_id mean what they say.
--   * The creator (not necessarily the missionary) starts the practice from
--     the paired summary. The creator stays the creator after a role swap.
--   * Pairing codes are six digits.
--   * Either participant can ask to restart; the other confirms or declines.

-- ---------------------------------------------------------------------------
-- Sessions: who created the practice, and as which role.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column creator_user_id uuid references auth.users (id) on delete cascade,
  add column creator_role text;

update public.sessions set creator_user_id = missionary_user_id, creator_role = 'missionary';

alter table public.sessions
  alter column creator_user_id set not null,
  alter column creator_role set not null,
  alter column creator_role set default 'missionary',
  add constraint sessions_creator_role_check check (creator_role in ('missionary', 'christian')),
  add constraint sessions_creator_seated
    check (creator_user_id = missionary_user_id or creator_user_id = christian_user_id),
  add constraint sessions_creator_holds_seat_while_waiting
    check (status <> 'waiting' or creator_user_id = missionary_user_id);

create index sessions_creator_user_id_idx on public.sessions (creator_user_id);

-- ---------------------------------------------------------------------------
-- Six-digit pairing codes. Live letter codes are dropped; a waiting creator
-- sees that the code expired and gets a new one.
-- ---------------------------------------------------------------------------
alter table app_private.pair_codes drop constraint pair_codes_format;
delete from app_private.pair_codes where code !~ '^[0-9]{6}$';
alter table app_private.pair_codes add constraint pair_codes_format check (code ~ '^[0-9]{6}$');

-- Random bytes come from gen_random_uuid() (pg_strong_random); the UUID
-- version and variant bytes are skipped, and rejection sampling avoids modulo bias.
create or replace function app_private.generate_pair_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  result text := '';
  bytes bytea;
  b integer;
begin
  while length(result) < 6 loop
    bytes := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      continue when i in (6, 8);
      b := get_byte(bytes, i);
      if b < 250 then
        result := result || (b % 10)::text;
        exit when length(result) = 6;
      end if;
    end loop;
  end loop;
  return result;
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
-- Creating and joining.
-- ---------------------------------------------------------------------------
drop function public.create_pair(text, integer, uuid);

create function public.create_pair(p_scenario_id text, p_version integer, p_request_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_session public.sessions;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_scenario_id is null or p_version is null or p_request_id is null or length(p_scenario_id) > 64
     or p_role is null or p_role not in ('missionary', 'christian') then
    return app_private.fail('invalid_input');
  end if;

  perform app_private.lock_user_action(v_uid, 'create');

  select l.session_id into v_existing
  from app_private.request_log l
  where l.user_id = v_uid and l.operation = 'create' and l.request_id = p_request_id;
  if found then
    select * into v_session from public.sessions s where s.id = v_existing;
    if not found then
      return app_private.fail('not_found');
    end if;
    if v_session.expires_at <= now() then
      return app_private.fail('session_expired');
    end if;
    return app_private.ok(app_private.session_state(v_session, v_uid));
  end if;

  if app_private.is_rate_limited(v_uid, 'create', 5, interval '1 hour') then
    return app_private.fail('rate_limited');
  end if;

  if not exists (
    select 1 from public.scenario_registry r
    where r.scenario_id = p_scenario_id and r.version = p_version and r.active_for_new_sessions
  ) then
    return app_private.fail('scenario_unavailable');
  end if;

  perform app_private.record_rate_event(v_uid, 'create');

  insert into public.sessions (scenario_id, scenario_version, missionary_user_id, creator_user_id, creator_role)
  values (p_scenario_id, p_version, v_uid, v_uid, p_role)
  returning * into v_session;

  perform app_private.issue_pair_code(v_session.id);
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  insert into app_private.request_log (user_id, operation, request_id, session_id)
  values (v_uid, 'create', p_request_id, v_session.id);

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create or replace function public.join_pair(p_code text, p_scenario_id text, p_version integer, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_code text;
  v_session_id uuid;
  v_session public.sessions;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_scenario_id is null or p_version is null or p_request_id is null or length(p_scenario_id) > 64 then
    return app_private.fail('invalid_input');
  end if;

  perform app_private.lock_user_action(v_uid, 'join');

  -- A retried request returns the seat it already claimed.
  select l.session_id into v_existing
  from app_private.request_log l
  where l.user_id = v_uid and l.operation = 'join' and l.request_id = p_request_id;
  if found then
    select * into v_session from public.sessions s where s.id = v_existing;
    if not found or not app_private.is_participant(v_session, v_uid) then
      return app_private.fail('not_found');
    end if;
    if v_session.expires_at <= now() then
      return app_private.fail('session_expired');
    end if;
    return app_private.ok(app_private.session_state(v_session, v_uid));
  end if;

  if app_private.is_rate_limited(v_uid, 'join', 10, interval '10 minutes') then
    return app_private.fail('rate_limited');
  end if;

  -- Every attempt counts. Failures below return instead of raising, so this
  -- row commits even when the guess is wrong.
  perform app_private.record_rate_event(v_uid, 'join');

  if p_code is null or length(p_code) > 32 then
    return app_private.fail('invalid_code');
  end if;
  v_code := regexp_replace(p_code, '[[:space:]-]', '', 'g');
  if v_code !~ '^[0-9]{6}$' then
    return app_private.fail('invalid_code');
  end if;

  select pc.session_id into v_session_id
  from app_private.pair_codes pc
  where pc.code = v_code and pc.expires_at > now();
  if not found then
    return app_private.fail('invalid_code');
  end if;

  -- Lock order everywhere: sessions row, then its pair code.
  select * into v_session from public.sessions s where s.id = v_session_id for update;
  if not found or v_session.expires_at <= now() then
    return app_private.fail('invalid_code');
  end if;

  perform 1 from app_private.pair_codes pc
  where pc.code = v_code and pc.session_id = v_session.id and pc.expires_at > now()
  for update;
  if not found then
    return app_private.fail('invalid_code');
  end if;

  if v_session.scenario_id <> p_scenario_id or v_session.scenario_version <> p_version then
    return app_private.fail('scenario_mismatch');
  end if;
  if v_session.missionary_user_id = v_uid then
    return app_private.fail('self_join');
  end if;
  if v_session.status <> 'waiting' or v_session.christian_user_id is not null then
    return app_private.fail('invalid_code');
  end if;

  -- The joiner takes the role the creator left open.
  update public.sessions s
  set missionary_user_id = case when s.creator_role = 'christian' then v_uid else s.missionary_user_id end,
      christian_user_id = case when s.creator_role = 'christian' then s.missionary_user_id else v_uid end,
      status = 'ready',
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  delete from app_private.pair_codes pc where pc.session_id = v_session.id;
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  insert into app_private.request_log (user_id, operation, request_id, session_id)
  values (v_uid, 'join', p_request_id, v_session.id);

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- Stage transitions: the creator starts the practice.
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

-- ---------------------------------------------------------------------------
-- Restart: either participant asks; the other confirms.
-- ---------------------------------------------------------------------------
create or replace function public.request_restart(p_session_id uuid, p_expected_revision bigint)
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
  set restart_requested_by = v_uid,
      restart_requested_at = now(),
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

-- ---------------------------------------------------------------------------
-- Execution grants.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema app_private from public, anon, authenticated;

revoke all on function public.create_pair(text, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.join_pair(text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.guided_event(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.request_restart(uuid, bigint) from public, anon, authenticated;
revoke all on function public.respond_restart(uuid, boolean, bigint) from public, anon, authenticated;

grant execute on function public.create_pair(text, integer, uuid, text) to authenticated;
grant execute on function public.join_pair(text, text, integer, uuid) to authenticated;
grant execute on function public.guided_event(uuid, text, text, bigint) to authenticated;
grant execute on function public.request_restart(uuid, bigint) to authenticated;
grant execute on function public.respond_restart(uuid, boolean, bigint) to authenticated;
