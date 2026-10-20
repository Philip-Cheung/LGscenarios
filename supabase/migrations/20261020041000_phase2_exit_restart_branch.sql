-- Phase 2: end a pair, restart with confirmation, and share one conditional branch.
--
-- Additive. Existing rows gain null request/branch columns and an empty branch
-- list. `ended` is terminal: later navigation, restart, swap, and heartbeat
-- commands cannot move it back to an active status.

alter table public.scenario_registry
  add column branch_options jsonb not null default '[]'::jsonb;

alter table public.scenario_registry
  add constraint scenario_registry_branch_options_array
  check (jsonb_typeof(branch_options) = 'array');

create or replace function app_private.guard_scenario_registry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.scenario_id is distinct from old.scenario_id
      or new.version is distinct from old.version
      or new.slug is distinct from old.slug
      or new.prompt_count is distinct from old.prompt_count
      or new.branch_options is distinct from old.branch_options then
      raise exception 'scenario registry identity, prompt_count, and branch_options are immutable';
    end if;
  end if;
  if exists (
    select 1
    from public.scenario_registry r
    where (r.slug = new.slug and r.scenario_id <> new.scenario_id)
       or (r.scenario_id = new.scenario_id and r.slug <> new.slug)
  ) then
    raise exception 'a slug must map to exactly one scenario_id';
  end if;
  return new;
end;
$$;

alter table public.sessions drop constraint sessions_status_check;
alter table public.sessions add constraint sessions_status_check
  check (status in ('waiting', 'ready', 'active', 'completed', 'expired', 'ended'));

alter table public.sessions drop constraint sessions_seated_when_started;
alter table public.sessions add constraint sessions_seated_when_started
  check (status in ('waiting', 'expired', 'ended') or christian_user_id is not null);

alter table public.sessions
  add column restart_requested_by uuid,
  add column restart_requested_at timestamptz,
  add column selected_branch_id text;

alter table public.sessions add constraint sessions_restart_by_missionary
  check (restart_requested_by is null or restart_requested_by = missionary_user_id);
alter table public.sessions add constraint sessions_restart_has_time
  check ((restart_requested_by is null) = (restart_requested_at is null));
alter table public.sessions add constraint sessions_one_pending_request
  check (swap_requested_by is null or restart_requested_by is null);
alter table public.sessions add constraint sessions_branch_id_format
  check (
    selected_branch_id is null
    or (selected_branch_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(selected_branch_id) <= 40)
  );

-- ---------------------------------------------------------------------------
-- Branch metadata and restart expiry. Callers that mutate already hold the
-- session row lock.
-- ---------------------------------------------------------------------------
create function app_private.allowed_branches(p_scenario_id text, p_version integer, p_prompt_index integer)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(option.option_id order by option.ordinality)
      from public.scenario_registry r
      cross join lateral jsonb_array_elements_text(r.branch_options -> p_prompt_index)
        with ordinality as option(option_id, ordinality)
      where r.scenario_id = p_scenario_id
        and r.version = p_version
        and jsonb_typeof(r.branch_options -> p_prompt_index) = 'array'
    ),
    array[]::text[]
  );
$$;

create function app_private.prompt_requires_branch(p_scenario_id text, p_version integer, p_prompt_index integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select cardinality(app_private.allowed_branches(p_scenario_id, p_version, p_prompt_index)) > 0
$$;

create function app_private.clear_expired_restart(p_session public.sessions)
returns public.sessions
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_session public.sessions := p_session;
begin
  if p_session.restart_requested_at is not null
     and p_session.restart_requested_at <= now() - interval '60 seconds' then
    update public.sessions s
      set restart_requested_by = null,
          restart_requested_at = null,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = p_session.id
        and s.restart_requested_at is not null
        and s.restart_requested_at <= now() - interval '60 seconds'
      returning * into v_session;
    if not found then
      select * into v_session from public.sessions s where s.id = p_session.id;
    end if;
  end if;
  return v_session;
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
    'prompt_index', p_session.prompt_index,
    'revision', p_session.revision,
    'round', p_session.round,
    'my_role', case when p_viewer = p_session.missionary_user_id then 'missionary' else 'christian' end,
    'partner_joined', p_session.christian_user_id is not null,
    'swap_pending', p_session.swap_requested_by is not null,
    'restart_pending', p_session.restart_requested_at is not null
      and p_session.restart_requested_at > now() - interval '60 seconds',
    'restart_requested_at', p_session.restart_requested_at,
    'selected_branch_id', p_session.selected_branch_id,
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
-- Replaced commands learn about ended, restart, and conditional prompts.
-- ---------------------------------------------------------------------------
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
     and not (v_session.selected_branch_id = any(app_private.allowed_branches(v_session.scenario_id, v_session.scenario_version, v_session.prompt_index))) then
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
     and not (v_session.selected_branch_id = any(app_private.allowed_branches(v_session.scenario_id, v_session.scenario_version, v_session.prompt_index))) then
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

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'completed'
     or v_session.swap_requested_by is not null
     or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set swap_requested_by = v_uid, revision = s.revision + 1, updated_at = now()
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

-- Renews presence. Revision changes only when an expired restart is cleared.
create or replace function public.heartbeat(p_session_id uuid)
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

  v_session := app_private.clear_expired_restart(v_session);
  perform app_private.touch_heartbeat(v_session.id, v_uid);
  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- End, restart, and branch selection.
-- ---------------------------------------------------------------------------
create function public.end_session(p_session_id uuid, p_expected_revision bigint)
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
  if v_session.status not in ('waiting', 'ready', 'active', 'completed') then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set status = 'ended',
      swap_requested_by = null,
      restart_requested_by = null,
      restart_requested_at = null,
      selected_branch_id = null,
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  delete from app_private.pair_codes where session_id = v_session.id;
  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.request_restart(p_session_id uuid, p_expected_revision bigint)
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

  if v_session.missionary_user_id <> v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
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

create function public.respond_restart(p_session_id uuid, p_accept boolean, p_expected_revision bigint)
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

create function public.cancel_restart(p_session_id uuid, p_expected_revision bigint)
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

  if v_session.restart_requested_by is distinct from v_uid then
    return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.revision <> p_expected_revision then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set restart_requested_by = null,
      restart_requested_at = null,
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

create function public.select_branch(
  p_session_id uuid,
  p_branch_id text,
  p_expected_revision bigint,
  p_expected_round integer
)
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
  if p_branch_id is null
     or p_expected_revision is null
     or p_expected_round is null
     or p_branch_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(p_branch_id) > 40 then
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
  if v_session.revision <> p_expected_revision or v_session.round <> p_expected_round then
    return app_private.fail('conflict', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.status <> 'active' or v_session.restart_requested_by is not null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;
  if not (p_branch_id = any(app_private.allowed_branches(v_session.scenario_id, v_session.scenario_version, v_session.prompt_index))) then
    return app_private.fail('invalid_input', app_private.session_state(v_session, v_uid));
  end if;
  if v_session.selected_branch_id = p_branch_id then
    return app_private.ok(app_private.session_state(v_session, v_uid));
  end if;

  update public.sessions s
  set selected_branch_id = p_branch_id,
      revision = s.revision + 1,
      updated_at = now()
  where s.id = v_session.id
  returning * into v_session;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

revoke all on function app_private.allowed_branches(text, integer, integer) from public, anon, authenticated;
revoke all on function app_private.prompt_requires_branch(text, integer, integer) from public, anon, authenticated;
revoke all on function app_private.clear_expired_restart(public.sessions) from public, anon, authenticated;

revoke all on function public.end_session(uuid, bigint) from public, anon, authenticated;
revoke all on function public.request_restart(uuid, bigint) from public, anon, authenticated;
revoke all on function public.respond_restart(uuid, boolean, bigint) from public, anon, authenticated;
revoke all on function public.cancel_restart(uuid, bigint) from public, anon, authenticated;
revoke all on function public.select_branch(uuid, text, bigint, integer) from public, anon, authenticated;

grant execute on function public.end_session(uuid, bigint) to authenticated;
grant execute on function public.request_restart(uuid, bigint) to authenticated;
grant execute on function public.respond_restart(uuid, boolean, bigint) to authenticated;
grant execute on function public.cancel_restart(uuid, bigint) to authenticated;
grant execute on function public.select_branch(uuid, text, bigint, integer) to authenticated;
