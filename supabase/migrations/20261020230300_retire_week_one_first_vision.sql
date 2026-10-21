-- Week 1 · We’re Christians too replaces Week One · The First Vision. The
-- published First Vision row stays (published rows are immutable, and pairs
-- already pinned to it keep working); it no longer opens for new pairs.

update public.scenario_registry
set active_for_new_sessions = false
where scenario_id = 'week-one-first-vision';
