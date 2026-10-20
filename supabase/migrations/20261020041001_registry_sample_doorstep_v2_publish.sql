-- Generated from src/scenarios/sample-doorstep.v2.ts. Do not edit.
-- sample-doorstep v2: "A conversation at the door" (3 prompts)
-- Publishes the cue-aware filler and stops new sessions on v1.

insert into public.scenario_registry (scenario_id, version, slug, prompt_count, branch_options, active_for_new_sessions)
values ('sample-doorstep', 2, 'sample-doorstep', 3, '[[],[],["they-agree","something-else"]]'::jsonb, false)
on conflict (scenario_id, version) do nothing;

do $$
begin
  if not exists (
    select 1 from public.scenario_registry
    where scenario_id = 'sample-doorstep'
      and version = 2
      and slug = 'sample-doorstep'
      and prompt_count = 3
      and branch_options = '[[],[],["they-agree","something-else"]]'::jsonb
  ) then
    raise exception 'registry entry sample-doorstep v2 does not match its content file';
  end if;
end;
$$;

update public.scenario_registry
set active_for_new_sessions = false
where scenario_id = 'sample-doorstep' and version <> 2;

update public.scenario_registry
set active_for_new_sessions = true
where scenario_id = 'sample-doorstep' and version = 2;
