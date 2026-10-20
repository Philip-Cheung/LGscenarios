-- Remembers which questions the pair has finished this round, so the
-- missionary's question list can mark them as answered.
--
-- A trigger keeps the list in step with every RPC: a question counts as
-- answered when the Christian finishes sharing (response -> question_selection),
-- and the list empties whenever a new round starts (restart or role swap).

alter table public.sessions
  add column answered_question_ids text[] not null default '{}',
  add constraint sessions_answered_question_ids_size check (cardinality(answered_question_ids) <= 12);

create function app_private.track_answered_questions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.round <> old.round then
    new.answered_question_ids := '{}';
  elsif old.stage = 'response'
     and new.stage = 'question_selection'
     and old.active_question_id is not null
     and not (old.active_question_id = any(old.answered_question_ids)) then
    new.answered_question_ids := array_append(old.answered_question_ids, old.active_question_id);
  end if;
  return new;
end;
$$;

revoke all on function app_private.track_answered_questions() from public, anon, authenticated;

create trigger sessions_track_answered_questions
before update on public.sessions
for each row execute function app_private.track_answered_questions();

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
