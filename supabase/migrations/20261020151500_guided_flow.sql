-- Guided flow: scenario content in the registry, and a staged, role-aware session.
--
-- Scenario content
--   * scenario_registry rows carry the validated scenario JSON (`content`) and a
--     draft/published status. Browsers can read every published version, so
--     sessions pinned to an older version still load; drafts stay hidden.
--   * Published rows are immutable. Drafts may be replaced until published.
--   * Older linear rows keep `content = null` and can no longer be played.
--
-- Session state
--   * A session moves through scene_setup, interaction_trigger,
--     opening_dialogue, question_selection, discussion, and conclusion.
--   * public.guided_event is the only command that advances a stage. It checks
--     the caller's role, the expected revision, the current stage, and that
--     question and follow-up ids exist in the pinned content.
--   * Restart and an accepted role swap return the pair to scene_setup.
--   * The linear prompt commands are no longer callable.

-- ---------------------------------------------------------------------------
-- Registry: content, status, publication time.
-- ---------------------------------------------------------------------------
alter table public.scenario_registry
  add column status text not null default 'published',
  add column content jsonb,
  add column published_at timestamptz;

update public.scenario_registry set published_at = created_at where published_at is null;

alter table public.scenario_registry alter column status set default 'draft';

alter table public.scenario_registry
  add constraint scenario_registry_status_check check (status in ('draft', 'published')),
  add constraint scenario_registry_published_at_matches_status
    check ((status = 'published') = (published_at is not null)),
  add constraint scenario_registry_active_is_published
    check (not active_for_new_sessions or status = 'published'),
  add constraint scenario_registry_content_identity
    check (
      content is null
      or (
        jsonb_typeof(content) = 'object'
        and content ->> 'schemaVersion' = '1.0'
        and content ->> 'id' = scenario_id
        and content -> 'version' = to_jsonb(version)
        and jsonb_typeof(content -> 'questions') = 'array'
      )
    ),
  add constraint scenario_registry_content_size check (content is null or pg_column_size(content) <= 262144);

create or replace function app_private.guard_scenario_registry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.scenario_id is distinct from old.scenario_id
      or new.version is distinct from old.version
      or new.slug is distinct from old.slug then
      raise exception 'scenario registry identity is immutable';
    end if;
    if old.status = 'published' and (
      new.status is distinct from old.status
      or new.content is distinct from old.content
      or new.prompt_count is distinct from old.prompt_count
      or new.branch_options is distinct from old.branch_options
      or new.published_at is distinct from old.published_at
    ) then
      raise exception 'published scenario versions are immutable';
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

drop policy "Published scenario versions are readable" on public.scenario_registry;

create policy "Published scenario versions are readable"
  on public.scenario_registry
  for select
  to anon, authenticated
  using (status = 'published');

-- The site root opens the most recently published scenario version.
create function public.featured_scenario()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select r.slug
  from public.scenario_registry r
  where r.active_for_new_sessions and r.content is not null
  order by r.published_at desc, r.scenario_id
  limit 1
$$;

revoke all on function public.featured_scenario() from public, anon, authenticated;
grant execute on function public.featured_scenario() to anon, authenticated;

-- Optional setting images, uploaded by an admin in the dashboard.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scenario-images', 'scenario-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sessions: guided stage state.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column stage text not null default 'scene_setup',
  add column missionary_ready boolean not null default false,
  add column christian_ready boolean not null default false,
  add column trigger_initiated boolean not null default false,
  add column active_question_id text,
  add column active_followup_id text,
  add column question_asked boolean not null default false;

update public.sessions set stage = 'conclusion' where status = 'completed';

alter table public.sessions
  add constraint sessions_stage_check
    check (stage in (
      'scene_setup', 'interaction_trigger', 'opening_dialogue', 'question_selection', 'discussion', 'conclusion'
    )),
  add constraint sessions_completed_at_conclusion check (status <> 'completed' or stage = 'conclusion'),
  add constraint sessions_conclusion_is_final
    check (stage <> 'conclusion' or status in ('completed', 'ended', 'expired')),
  add constraint sessions_question_id_format
    check (
      active_question_id is null
      or (active_question_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(active_question_id) <= 40)
    ),
  add constraint sessions_followup_id_format
    check (
      active_followup_id is null
      or (active_followup_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(active_followup_id) <= 40)
    ),
  add constraint sessions_followup_needs_question check (active_followup_id is null or active_question_id is not null),
  add constraint sessions_discussion_has_question check (stage <> 'discussion' or active_question_id is not null);

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
    'stage', p_session.stage,
    'my_ready', case
      when p_viewer = p_session.missionary_user_id then p_session.missionary_ready
      else p_session.christian_ready
    end,
    'partner_ready', case
      when p_viewer = p_session.missionary_user_id then p_session.christian_ready
      else p_session.missionary_ready
    end,
    'trigger_initiated', p_session.trigger_initiated,
    'active_question_id', p_session.active_question_id,
    'active_followup_id', p_session.active_followup_id,
    'question_asked', p_session.question_asked,
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
create function public.guided_event(
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
  v_question jsonb;
begin
  if v_uid is null then
    return app_private.fail('not_authenticated');
  end if;
  if p_event is null
     or p_expected_revision is null
     or p_event not in (
       'ready', 'trigger_initiate', 'trigger_acknowledge', 'opening_complete', 'select_question',
       'question_asked', 'select_followup', 'return_to_questions', 'finish_discussion'
     )
     or (p_event in ('select_question', 'select_followup')) <> (p_target_id is not null)
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
  if v_content is null then
    return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
  end if;

  case p_event
    when 'ready' then
      if v_session.stage <> 'scene_setup' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set missionary_ready = s.missionary_ready or v_role = 'missionary',
          christian_ready = s.christian_ready or v_role = 'christian',
          stage = case
            when (s.missionary_ready or v_role = 'missionary') and (s.christian_ready or v_role = 'christian')
              then 'interaction_trigger'
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

    when 'trigger_initiate' then
      if v_session.stage <> 'interaction_trigger' or v_session.trigger_initiated then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      if v_role is distinct from v_content -> 'interactionTrigger' ->> 'initiatingRole' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set trigger_initiated = true, revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'trigger_acknowledge' then
      if v_session.stage <> 'interaction_trigger' or not v_session.trigger_initiated then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      if v_role = v_content -> 'interactionTrigger' ->> 'initiatingRole' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'opening_dialogue', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'opening_complete' then
      if v_session.stage <> 'opening_dialogue' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      if v_role is distinct from v_content -> 'openingDialogue' ->> 'speakerRole' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'question_selection', revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'select_question' then
      if v_role <> 'missionary' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      if v_session.stage <> 'question_selection' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_content -> 'questions') q where q ->> 'id' = p_target_id
      ) then
        return app_private.fail('invalid_input', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'discussion',
          active_question_id = p_target_id,
          active_followup_id = null,
          question_asked = false,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'question_asked' then
      if v_role <> 'missionary' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      if v_session.stage <> 'discussion' or v_session.question_asked then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set question_asked = true, revision = s.revision + 1, updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'select_followup' then
      if v_role <> 'missionary' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      if v_session.stage <> 'discussion' or not v_session.question_asked then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      select q into v_question
      from jsonb_array_elements(v_content -> 'questions') q
      where q ->> 'id' = v_session.active_question_id;
      if v_question is null or not exists (
        select 1
        from jsonb_array_elements(coalesce(v_question -> 'followUps', '[]'::jsonb)) f
        where f ->> 'id' = p_target_id
      ) then
        return app_private.fail('invalid_input', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set active_followup_id = p_target_id,
          question_asked = false,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'return_to_questions' then
      if v_role <> 'missionary' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      if v_session.stage <> 'discussion' then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'question_selection',
          active_question_id = null,
          active_followup_id = null,
          question_asked = false,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;

    when 'finish_discussion' then
      if v_role <> 'missionary' then
        return app_private.fail('forbidden', app_private.session_state(v_session, v_uid));
      end if;
      if v_session.stage not in ('question_selection', 'discussion') then
        return app_private.fail('invalid_state', app_private.session_state(v_session, v_uid));
      end if;
      update public.sessions s
      set stage = 'conclusion',
          status = 'completed',
          active_question_id = null,
          active_followup_id = null,
          question_asked = false,
          revision = s.revision + 1,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;
  end case;

  return app_private.ok(app_private.session_state(v_session, v_uid));
end;
$$;

revoke all on function public.guided_event(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.guided_event(uuid, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Restart and role swap return the pair to the scene.
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
        status = 'active',
        stage = 'scene_setup',
        missionary_ready = false,
        christian_ready = false,
        trigger_initiated = false,
        active_question_id = null,
        active_followup_id = null,
        question_asked = false,
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
        trigger_initiated = false,
        active_question_id = null,
        active_followup_id = null,
        question_asked = false,
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
-- The linear prompt commands are replaced by guided_event.
-- ---------------------------------------------------------------------------
revoke execute on function public.start_pair(uuid, bigint) from authenticated;
revoke execute on function public.navigate(uuid, text, bigint) from authenticated;
revoke execute on function public.finish_pair(uuid, bigint) from authenticated;
revoke execute on function public.select_branch(uuid, text, bigint, integer) from authenticated;
