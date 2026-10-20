-- Doorstep Practice: core schema, private schema, grants, and row level security.
--
-- Access model
--   * Browsers read published registry rows and their own unexpired session row.
--   * Browsers never write tables directly; all state changes go through the
--     narrow RPCs in the session_rpcs migration.
--   * Pairing codes, heartbeats, idempotency keys, and abuse counters live in
--     app_private, which is not exposed through the Data API.

-- ---------------------------------------------------------------------------
-- Nothing created in these schemas is exposed implicitly.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke select, insert, update, delete on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trusted scenario registry. Rows are generated from validated content files
-- (scripts/generate-registry-migration.ts). Identity and prompt_count are
-- immutable once inserted; only active_for_new_sessions may change.
-- ---------------------------------------------------------------------------
create table public.scenario_registry (
  scenario_id text not null,
  version integer not null,
  slug text not null,
  prompt_count integer not null,
  active_for_new_sessions boolean not null default false,
  created_at timestamptz not null default now(),
  constraint scenario_registry_pkey primary key (scenario_id, version),
  constraint scenario_registry_slug_version_key unique (slug, version),
  constraint scenario_registry_scenario_id_format
    check (scenario_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(scenario_id) <= 64),
  constraint scenario_registry_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  constraint scenario_registry_version_positive check (version > 0),
  constraint scenario_registry_prompt_count_range check (prompt_count between 1 and 200)
);

create function app_private.guard_scenario_registry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.scenario_id is distinct from old.scenario_id
      or new.version is distinct from old.version
      or new.slug is distinct from old.slug
      or new.prompt_count is distinct from old.prompt_count then
      raise exception 'scenario registry identity and prompt_count are immutable';
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

create trigger scenario_registry_guard
  before insert or update on public.scenario_registry
  for each row execute function app_private.guard_scenario_registry();

-- ---------------------------------------------------------------------------
-- One row per pair, with exactly two seats.
-- ---------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  scenario_id text not null,
  scenario_version integer not null,
  missionary_user_id uuid not null references auth.users (id) on delete cascade,
  christian_user_id uuid references auth.users (id) on delete cascade,
  status text not null default 'waiting',
  prompt_index integer not null default 0,
  revision bigint not null default 0,
  round integer not null default 1,
  swap_requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  constraint sessions_scenario_fkey foreign key (scenario_id, scenario_version)
    references public.scenario_registry (scenario_id, version),
  constraint sessions_status_check
    check (status in ('waiting', 'ready', 'active', 'completed', 'expired')),
  constraint sessions_distinct_seats
    check (christian_user_id is null or christian_user_id <> missionary_user_id),
  constraint sessions_prompt_index_nonnegative check (prompt_index >= 0),
  constraint sessions_round_positive check (round >= 1),
  constraint sessions_swap_by_missionary
    check (swap_requested_by is null or swap_requested_by = missionary_user_id),
  constraint sessions_seated_when_started
    check (status in ('waiting', 'expired') or christian_user_id is not null)
);

create index sessions_missionary_user_id_idx on public.sessions (missionary_user_id);
create index sessions_christian_user_id_idx on public.sessions (christian_user_id);
create index sessions_expires_at_idx on public.sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Private tables. Never exposed; reached only through SECURITY DEFINER RPCs.
-- ---------------------------------------------------------------------------
create table app_private.pair_codes (
  code text primary key,
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pair_codes_format check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$')
);

create index pair_codes_expires_at_idx on app_private.pair_codes (expires_at);

create table app_private.heartbeats (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null,
  last_seen_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table app_private.request_log (
  user_id uuid not null,
  operation text not null,
  request_id uuid not null,
  session_id uuid not null references public.sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, operation, request_id),
  constraint request_log_operation_check check (operation in ('create', 'join'))
);

create index request_log_session_id_idx on app_private.request_log (session_id);

create table app_private.rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now(),
  constraint rate_events_action_check check (action in ('create', 'join', 'regenerate'))
);

create index rate_events_lookup_idx on app_private.rate_events (user_id, action, created_at);
create index rate_events_created_at_idx on app_private.rate_events (created_at);

-- ---------------------------------------------------------------------------
-- Grants. Explicit and minimal: browsers may only SELECT, and RLS limits rows.
-- ---------------------------------------------------------------------------
revoke all on table public.scenario_registry from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;
revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke all on function app_private.guard_scenario_registry() from public, anon, authenticated;

grant select on table public.scenario_registry to anon, authenticated;
grant select on table public.sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.scenario_registry enable row level security;
alter table public.sessions enable row level security;
alter table app_private.pair_codes enable row level security;
alter table app_private.heartbeats enable row level security;
alter table app_private.request_log enable row level security;
alter table app_private.rate_events enable row level security;

create policy "Published scenario versions are readable"
  on public.scenario_registry
  for select
  to anon, authenticated
  using (active_for_new_sessions);

-- Also authorizes Realtime Postgres Changes events for this table.
create policy "Participants can read their unexpired session"
  on public.sessions
  for select
  to authenticated
  using (
    ((select auth.uid()) = missionary_user_id or (select auth.uid()) = christian_user_id)
    and expires_at > now()
  );
