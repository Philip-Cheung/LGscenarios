-- Doorstep Practice: session RPCs.
--
-- Every entry point:
--   * derives identity from auth.uid() and never trusts caller-supplied user
--     ids, roles, prompt counts, or timestamps;
--   * locks the session row and checks expected_revision in one transaction;
--   * returns {"ok": true, "session": {...}} or
--     {"ok": false, "error": "<code>", "session": {...}|null} rather than
--     raising, so abuse counters recorded before a failure are committed.
--
-- Private helpers live in app_private and are not executable by clients.

-- ---------------------------------------------------------------------------
-- Tunables
-- ---------------------------------------------------------------------------
create function app_private.heartbeat_stale_after()
returns interval language sql immutable set search_path = '' as $$ select interval '45 seconds' $$;

create function app_private.pair_code_lifetime()
returns interval language sql immutable set search_path = '' as $$ select interval '15 minutes' $$;

-- ---------------------------------------------------------------------------
-- Result helpers
-- ---------------------------------------------------------------------------
create function app_private.ok(p_session jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', true, 'session', p_session)
$$;

create function app_private.fail(p_error text, p_session jsonb default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', p_error, 'session', p_session)
$$;

-- ---------------------------------------------------------------------------
-- Session helpers
-- ---------------------------------------------------------------------------
create function app_private.is_participant(p_session public.sessions, p_user uuid)
returns boolean language sql immutable set search_path = '' as $$
  select p_user is not null
    and (p_user = p_session.missionary_user_id
         or (p_session.christian_user_id is not null and p_user = p_session.christian_user_id))
$$;

create function app_private.is_fresh(p_session_id uuid, p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from app_private.heartbeats h
    where h.session_id = p_session_id
      and h.user_id = p_user
      and h.last_seen_at > now() - app_private.heartbeat_stale_after()
  )
$$;

create function app_private.partner_of(p_session public.sessions, p_viewer uuid)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_viewer = p_session.missionary_user_id then p_session.christian_user_id
    else p_session.missionary_user_id
  end
$$;

create function app_private.touch_heartbeat(p_session_id uuid, p_user uuid)
returns void language sql volatile set search_path = '' as $$
  insert into app_private.heartbeats (session_id, user_id, last_seen_at)
  values (p_session_id, p_user, now())
  on conflict (session_id, user_id) do update set last_seen_at = excluded.last_seen_at
$$;

-- The participant-facing view of a session. The pairing code is included only
-- for the current missionary while waiting, and never in Realtime payloads.
create function app_private.session_state(p_session public.sessions, p_viewer uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_session.id,
    'scenario_id', p_session.scenario_id,
    'scenario_version', p_session.scenario_version,
    'status', case when p_session.expires_at <= now() then 'expired' else p_session.status end,
    'prompt_index', p_session.prompt_index,
    'revision', p_session.revision,
    'round', p_session.round,
    'my_role', case when p_viewer = p_session.missionary_user_id then 'missionary' else 'christian' end,
    'partner_joined', p_session.christian_user_id is not null,
    'swap_pending', p_session.swap_requested_by is not null,
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
-- Rate limiting. Callers hold a per-user advisory lock for the action.
-- ---------------------------------------------------------------------------
create function app_private.is_rate_limited(p_user uuid, p_action text, p_max integer, p_window interval)
returns boolean language sql stable set search_path = '' as $$
  select count(*) >= p_max
  from app_private.rate_events e
  where e.user_id = p_user
    and e.action = p_action
    and e.created_at > now() - p_window
$$;

create function app_private.record_rate_event(p_user uuid, p_action text)
returns void language sql volatile set search_path = '' as $$
  insert into app_private.rate_events (user_id, action) values (p_user, p_action)
$$;

create function app_private.lock_user_action(p_user uuid, p_action text)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('doorstep:' || p_action || ':' || p_user::text, 0))
$$;

-- ---------------------------------------------------------------------------
-- Pairing codes
-- ---------------------------------------------------------------------------

-- Six characters from a 31-symbol alphabet without 0/O, 1/I/L. Random bytes
-- come from gen_random_uuid() (pg_strong_random); the UUID version and variant
-- bytes are skipped, and rejection sampling avoids modulo bias.
create function app_private.generate_pair_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  bytes bytea;
  b integer;
begin
  while length(result) < 6 loop
    bytes := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      continue when i in (6, 8);
      b := get_byte(bytes, i);
      if b < 248 then
        result := result || substr(alphabet, (b % 31) + 1, 1);
        exit when length(result) = 6;
      end if;
    end loop;
  end loop;
  return result;
end;
$$;

-- Replaces any code for the session with a fresh unique one. Expired codes
-- that collide are reclaimed; live collisions are retried.
create function app_private.issue_pair_code(p_session_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_code text;
begin
  delete from app_private.pair_codes where session_id = p_session_id;
  for attempt in 1..20 loop
    v_code := app_private.generate_pair_code();
    delete from app_private.pair_codes where code = v_code and expires_at <= now();
    begin
      insert into app_private.pair_codes (code, session_id, expires_at)
      values (v_code, p_session_id, now() + app_private.pair_code_lifetime());
      return;
    exception when unique_violation then
      continue;
    end;
  end loop;
  raise exception 'could not allocate a unique pairing code';
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

create function public.create_pair(p_scenario_id text, p_version integer, p_request_id uuid)
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
  if p_scenario_id is null or p_version is null or p_request_id is null or length(p_scenario_id) > 64 then
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

  insert into public.sessions (scenario_id, scenario_version, missionary_user_id)
  values (p_scenario_id, p_version, v_uid)
  returning * into v_session;

  perform app_private.issue_pair_code(v_session.id);
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  insert into app_private.request_log (user_id, operation, request_id, session_id)
  values (v_uid, 'create', p_request_id, v_session.id);

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.join_pair(p_code text, p_scenario_id text, p_version integer, p_request_id uuid)
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
  v_code := upper(regexp_replace(p_code, '[[:space:]-]', '', 'g'));
  if v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then
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

  update public.sessions s
  set christian_user_id = v_uid,
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

create function public.regenerate_pair_code(p_session_id uuid)
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

  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found or not app_private.is_participant(v_session, v_uid) then
    return app_private.fail('not_found');
  end if;
  if v_session.expires_at <= now() then
    return app_private.fail('session_expired');
  end if;
  perform app_private.touch_heartbeat(v_session.id, v_uid);
  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'waiting' or exists (
    select 1 from app_private.pair_codes pc where pc.session_id = v_session.id and pc.expires_at > now()
  ) then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  perform app_private.lock_user_action(v_uid, 'regenerate');
  if app_private.is_rate_limited(v_uid, 'regenerate', 5, interval '1 hour') then
    return app_private.fail('rate_limited', app_private.session_state(v_session, v_uid));
  end if;
  perform app_private.record_rate_event(v_uid, 'regenerate');
  perform app_private.issue_pair_code(v_session.id);

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.start_pair(p_session_id uuid, p_expected_revision bigint)
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
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'ready' or v_session.christian_user_id is null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;
  if not app_private.is_fresh(v_session.id, v_session.christian_user_id) then
    return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set status = 'active', prompt_index = 0, revision = s.revision + 1, updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.navigate(p_session_id uuid, p_direction text, p_expected_revision bigint)
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
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'active' then
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

  update public.sessions s
  set prompt_index = v_next_index, revision = s.revision + 1, updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.finish_pair(p_session_id uuid, p_expected_revision bigint)
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
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'active' then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  select r.prompt_count into v_prompt_count
  from public.scenario_registry r
  where r.scenario_id = v_session.scenario_id and r.version = v_session.scenario_version;

  if v_session.prompt_index <> v_prompt_count - 1 then
    return app_private.fail('out_of_range', app_private.session_state(v_session, v_uid));
  end if;
  if not app_private.is_fresh(v_session.id, v_session.christian_user_id) then
    return app_private.fail('partner_stale', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set status = 'completed', revision = s.revision + 1, updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.request_swap(p_session_id uuid, p_expected_revision bigint)
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
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'completed' or v_session.swap_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set swap_requested_by = v_uid, revision = s.revision + 1, updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.respond_swap(p_session_id uuid, p_accept boolean, p_expected_revision bigint)
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
  perform app_private.touch_heartbeat(v_session.id, v_uid);

  if v_session.christian_user_id is distinct from v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'completed'
    or v_session.swap_requested_by is distinct from v_session.missionary_user_id then
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
        round = s.round + 1,
        prompt_index = 0,
        status = 'active',
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

-- Renews the caller's presence and returns authoritative state. Does not
-- change the session revision.
create function public.heartbeat(p_session_id uuid)
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

  select * into v_session from public.sessions s where s.id = p_session_id;
  if not found or not app_private.is_participant(v_session, v_uid) then
    return app_private.fail('not_found');
  end if;
  if v_session.expires_at <= now() then
    return app_private.fail('session_expired');
  end if;

  perform app_private.touch_heartbeat(v_session.id, v_uid);
  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

-- Read-only authoritative state for a participant.
create function public.get_session(p_session_id uuid)
returns jsonb
language plpgsql
stable
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

  select * into v_session from public.sessions s where s.id = p_session_id;
  if not found or not app_private.is_participant(v_session, v_uid) then
    return app_private.fail('not_found');
  end if;
  if v_session.expires_at <= now() then
    return app_private.fail('session_expired');
  end if;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution grants: only the intended entry points, only for authenticated.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema app_private from public, anon, authenticated;

revoke all on function public.create_pair(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.join_pair(text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.regenerate_pair_code(uuid) from public, anon, authenticated;
revoke all on function public.start_pair(uuid, bigint) from public, anon, authenticated;
revoke all on function public.navigate(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.finish_pair(uuid, bigint) from public, anon, authenticated;
revoke all on function public.request_swap(uuid, bigint) from public, anon, authenticated;
revoke all on function public.respond_swap(uuid, boolean, bigint) from public, anon, authenticated;
revoke all on function public.heartbeat(uuid) from public, anon, authenticated;
revoke all on function public.get_session(uuid) from public, anon, authenticated;

grant execute on function public.create_pair(text, integer, uuid) to authenticated;
grant execute on function public.join_pair(text, text, integer, uuid) to authenticated;
grant execute on function public.regenerate_pair_code(uuid) to authenticated;
grant execute on function public.start_pair(uuid, bigint) to authenticated;
grant execute on function public.navigate(uuid, text, bigint) to authenticated;
grant execute on function public.finish_pair(uuid, bigint) to authenticated;
grant execute on function public.request_swap(uuid, bigint) to authenticated;
grant execute on function public.respond_swap(uuid, boolean, bigint) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.get_session(uuid) to authenticated;
