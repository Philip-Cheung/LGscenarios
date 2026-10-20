-- Doorstep Practice: Realtime publication, cleanup, and maintenance.

-- ---------------------------------------------------------------------------
-- Realtime: publish only the sessions table. Event delivery is authorized by
-- the sessions SELECT policy (participants of unexpired sessions only).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; add public.sessions to it once Realtime is enabled';
  elsif not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cleanup. Expiry is enforced by every read and RPC regardless of when this
-- runs; cleanup only bounds retention. App records are kept at most ~1 hour
-- past expiry (well inside the 24 hour limit), and abuse counters only for
-- their longest window plus margin.
-- ---------------------------------------------------------------------------
create function app_private.cleanup_expired()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app_private.pair_codes where expires_at <= now();
  update public.sessions set status = 'expired', updated_at = now()
  where expires_at <= now() and status <> 'expired';
  delete from public.sessions where expires_at <= now() - interval '1 hour';
  delete from app_private.heartbeats where last_seen_at <= now() - interval '13 hours';
  delete from app_private.request_log where created_at <= now() - interval '13 hours';
  delete from app_private.rate_events where created_at <= now() - interval '2 hours';
end;
$$;

-- Removes anonymous Auth users that are no longer seated in any unexpired
-- session. Run from trusted tooling only (SQL editor, pg_cron, or CI with a
-- database connection). Not executable by browser roles.
create function app_private.cleanup_anonymous_users(p_older_than interval default interval '2 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_older_than < interval '13 hours' then
    raise exception 'p_older_than must be at least 13 hours so active participants are never removed';
  end if;
  delete from auth.users u
  where u.is_anonymous is true
    and u.created_at < now() - p_older_than
    and not exists (
      select 1 from public.sessions s
      where (s.missionary_user_id = u.id or s.christian_user_id = u.id)
        and s.expires_at > now()
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function app_private.cleanup_expired() from public, anon, authenticated;
revoke all on function app_private.cleanup_anonymous_users(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule cleanup with Supabase Cron when available. Anonymous-user cleanup
-- is scheduled too; both are idempotent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('doorstep-cleanup-expired', '*/15 * * * *', 'select app_private.cleanup_expired()');
    perform cron.schedule('doorstep-cleanup-anonymous-users', '41 3 * * *', 'select app_private.cleanup_anonymous_users()');
  else
    raise notice 'pg_cron is not available; schedule app_private.cleanup_expired() externally';
  end if;
end;
$$;
