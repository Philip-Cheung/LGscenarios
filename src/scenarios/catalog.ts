import type { SupabaseClient } from '@supabase/supabase-js'
import { ALL_SCENARIO_SCHEMA_VERSIONS, parseScenarioContent, type AnyScenarioContent } from '../lib/content'

export type ScenarioLookup =
  | { status: 'ok'; scenario: AnyScenarioContent }
  /** No published version, or none open for new pairs. */
  | { status: 'unavailable' }
  /** A version from before guided scenarios; it has no content to render. */
  | { status: 'retired' }
  /** Content written for a newer app; a refresh loads it. */
  | { status: 'outdated' }
  | { status: 'error' }

interface RegistryRow {
  scenario_id: string
  version: number
  content: unknown
}

const SELECT = 'scenario_id, version, content'
const IMAGE_BUCKET = 'scenario-images'

// Published versions never change, so a version is fetched once per page load.
const versions = new Map<string, AnyScenarioContent>()
const versionKey = (scenarioId: string, version: number) => `${scenarioId}@${version}`

function fromRow(row: RegistryRow): ScenarioLookup {
  if (row.content === null) return { status: 'retired' }
  const declared = (row.content as { schemaVersion?: unknown } | null)?.schemaVersion
  if (!(ALL_SCENARIO_SCHEMA_VERSIONS as readonly unknown[]).includes(declared)) return { status: 'outdated' }
  const parsed = parseScenarioContent(row.content)
  if (!parsed.success || parsed.data.id !== row.scenario_id || parsed.data.version !== row.version) {
    return { status: 'unavailable' }
  }
  versions.set(versionKey(row.scenario_id, row.version), parsed.data)
  return { status: 'ok', scenario: parsed.data }
}

/** The newest version open for new pairs at `/s/:slug`. Always asks the server. */
export async function fetchActiveScenario(client: SupabaseClient, slug: string): Promise<ScenarioLookup> {
  try {
    const { data, error } = await client
      .from('scenario_registry')
      .select(SELECT)
      .eq('slug', slug)
      .eq('active_for_new_sessions', true)
      .order('version', { ascending: false })
      .limit(1)
    if (error) return { status: 'error' }
    const row = data?.[0] as RegistryRow | undefined
    return row ? fromRow(row) : { status: 'unavailable' }
  } catch {
    return { status: 'error' }
  }
}

/** The exact published version a session is pinned to. */
export async function fetchScenarioVersion(
  client: SupabaseClient,
  scenarioId: string,
  version: number,
): Promise<ScenarioLookup> {
  const cached = versions.get(versionKey(scenarioId, version))
  if (cached) return { status: 'ok', scenario: cached }
  try {
    const { data, error } = await client
      .from('scenario_registry')
      .select(SELECT)
      .eq('scenario_id', scenarioId)
      .eq('version', version)
      .maybeSingle()
    if (error) return { status: 'error' }
    return data ? fromRow(data as RegistryRow) : { status: 'unavailable' }
  } catch {
    return { status: 'error' }
  }
}

export type FeaturedLookup = { status: 'ok'; slug: string } | { status: 'none' } | { status: 'error' }

/** The slug the site root opens: the most recently published scenario. */
export async function fetchFeaturedSlug(client: SupabaseClient): Promise<FeaturedLookup> {
  try {
    const { data, error } = await client.rpc('featured_scenario')
    if (error) return { status: 'error' }
    return typeof data === 'string' && data ? { status: 'ok', slug: data } : { status: 'none' }
  } catch {
    return { status: 'error' }
  }
}

/** Public URL for a setting image stored in the `scenario-images` bucket. */
export function scenarioImageUrl(supabaseUrl: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${new URL(supabaseUrl).origin}/storage/v1/object/public/${IMAGE_BUCKET}/${encoded}`
}
