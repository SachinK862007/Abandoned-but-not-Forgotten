// Migration CLI (plain Node, no loader, no build step).
//
//   npm run db:migrate    apply pending migrations
//   npm run db:rollback   undo the newest applied migration
//   npm run db:status     show applied + pending migrations
//
// Uses the same PostgreSQL (Neon) database as the deployed app and the same
// migration definitions as `lib/db.ts`.
import { neon } from '@neondatabase/serverless'
import {
  appliedVersions,
  migrateDown,
  migrateUp,
  pendingMigrations,
} from '../lib/migrations.mjs'
import { loadEnv, requireDatabaseUrl } from './env.mjs'

loadEnv()
const sql = neon(requireDatabaseUrl())

try {
  if (process.argv.includes('--down')) {
    const undone = await migrateDown(sql)
    console.log(undone ? `Rolled back: ${undone}` : 'Nothing to roll back.')
  } else if (process.argv.includes('--status')) {
    const applied = await appliedVersions(sql)
    const pending = await pendingMigrations(sql)
    console.log(`applied: ${applied.join(', ') || '(none)'}`)
    console.log(`pending: ${pending.join(', ') || '(none)'}`)
  } else {
    const applied = await migrateUp(sql)
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
  }
  console.log(`applied: ${(await appliedVersions(sql)).join(', ') || '(none)'}`)
  console.log(`pending: ${(await pendingMigrations(sql)).join(', ') || '(none)'}`)
} catch (error) {
  // Never print the connection string or driver internals.
  console.error('Migration failed:', error instanceof Error ? error.message : 'unknown error')
  process.exit(1)
}
