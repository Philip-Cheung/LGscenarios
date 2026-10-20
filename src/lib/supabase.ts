import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from './env'

let client: SupabaseClient | null = null

export function getSupabase(config: AppConfig): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'doorstep-practice-auth',
      },
    })
  }
  return client
}
