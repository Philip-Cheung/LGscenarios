import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScenarioContent } from '../lib/content'
import { findScenarioVersion } from '../scenarios'

export type VersionResolution =
  | { status: 'ok'; scenario: ScenarioContent }
  | { status: 'unavailable' }
  | { status: 'outdated' }
  | { status: 'error' }

/**
 * New pairs use the latest version the registry has published for the slug.
 * If this bundle does not contain that version, the page must be refreshed.
 */
export async function resolvePublishedVersion(client: SupabaseClient, slug: string): Promise<VersionResolution> {
  try {
    const { data, error } = await client
      .from('scenario_registry')
      .select('scenario_id, version')
      .eq('slug', slug)
      .eq('active_for_new_sessions', true)
      .order('version', { ascending: false })
      .limit(1)
    if (error) return { status: 'error' }
    const row = data?.[0] as { scenario_id: string; version: number } | undefined
    if (!row) return { status: 'unavailable' }
    const scenario = findScenarioVersion(row.scenario_id, row.version)
    return scenario ? { status: 'ok', scenario } : { status: 'outdated' }
  } catch {
    return { status: 'error' }
  }
}
