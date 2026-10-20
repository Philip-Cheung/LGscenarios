-- A partner joining by code takes the room's scenario and version, whichever
-- scenario link they entered from. The code is what admits them; the link they
-- opened no longer decides (or blocks) which conversation they join.
-- p_scenario_id and p_version stay in the signature for existing clients.

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

revoke all on function public.join_pair(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.join_pair(text, text, integer, uuid) to authenticated;
