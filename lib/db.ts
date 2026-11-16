// Server-only PostgreSQL access.
//
// Production storage is a managed PostgreSQL database (Neon) reached through
// the Neon serverless driver: each query is a short-lived HTTPS request, so
// nothing depends on a connection surviving a function invocation and there is
// no per-request connection to open or close.
//
// `DATABASE_URL` is a server-only secret. It is never read by client code, never
// returned by an API and never logged. When it is missing the app reports the
// database as unavailable instead of silently falling back to a local file —
// Vercel's filesystem is not durable, so a file-backed fallback would lose data.
//
// No `node:*` filesystem or SQLite access happens here any more.
import { neon } from '@neondatabase/serverless'
import { migrateUp } from './migrations.mjs'

/** Thrown when the database is not configured or cannot be reached. */
export class DatabaseUnavailableError extends Error {
  constructor(message = 'database unavailable') {
    super(message)
    this.name = 'DatabaseUnavailableError'
  }
}

let client: ReturnType<typeof neon> | null = null
let schemaReady: Promise<void> | null = null

function connectionString(): string {
  return (process.env.DATABASE_URL ?? '').trim()
}

export function isDatabaseConfigured(): boolean {
  return connectionString().length > 0
}

function getClient(): ReturnType<typeof neon> {
  if (client) return client
  const url = connectionString()
  if (!url) throw new DatabaseUnavailableError('DATABASE_URL is not set')
  client = neon(url)
  return client
}

/**
 * Ready-to-use `sql` tagged-template function. The first call in a process also
 * applies any pending migration once; later calls reuse the same promise, so a
 * warm instance never re-runs DDL.
 */
export async function getSql(): Promise<ReturnType<typeof neon>> {
  const sql = getClient()
  if (!schemaReady) {
    schemaReady = migrateUp(sql)
      .then(() => undefined)
      .catch((error: unknown) => {
        // Do not cache a failure: the next request should be able to retry once
        // the database is reachable again.
        schemaReady = null
        throw error
      })
  }
  await schemaReady
  return sql
}

/** Cheap liveness probe used by the health route. */
export async function pingDatabase(): Promise<void> {
  const sql = getClient()
  await sql`SELECT 1 AS ok`
}
