import pg from 'pg'
import { assertDisposableTarget } from '../../supabase/tests/target'

/**
 * Verifies the target is the disposable test project before any browser
 * starts, and afterwards removes the anonymous users (and, by cascade, the
 * sessions) this run created.
 */
export default async function globalSetup() {
  const target = assertDisposableTarget()
  const db = new pg.Pool({ connectionString: target.databaseUrl, max: 1 })
  const { rows } = await db.query<{ now: Date }>('select now() as now')
  const runStartedAt = rows[0].now

  return async () => {
    try {
      await db.query(
        `delete from app_private.rate_events e
          using auth.users u
          where e.user_id = u.id and u.is_anonymous and u.created_at >= $1`,
        [runStartedAt],
      )
      await db.query('delete from auth.users where is_anonymous and created_at >= $1', [runStartedAt])
    } finally {
      await db.end()
    }
  }
}
