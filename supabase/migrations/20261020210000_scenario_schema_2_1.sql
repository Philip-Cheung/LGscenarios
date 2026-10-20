-- Registry content may use scenario schema 2.1 (opening question, follow-ups,
-- help, and bundled Bible passages). 1.0 rows remain for retired versions.

alter table public.scenario_registry drop constraint scenario_registry_content_identity;
alter table public.scenario_registry
  add constraint scenario_registry_content_identity
    check (
      content is null
      or (
        jsonb_typeof(content) = 'object'
        and content ->> 'schemaVersion' in ('1.0', '2.0', '2.1')
        and content ->> 'id' = scenario_id
        and content -> 'version' = to_jsonb(version)
        and jsonb_typeof(content -> 'questions') = 'array'
      )
    );
