// One-off export of the legacy local SQLite mission log.
//
// The old release stored missions in `.data/space-relics.db`. Nothing here is
// needed in production any more; this script exists so existing local records
// can be moved into PostgreSQL instead of being silently discarded.
//
//   npm run db:export-sqlite            writes missions-export.json
//   npm run db:export-sqlite -- out.json
//
// The file is git-ignored because it contains anonymous session identifiers.
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv } from './env.mjs'

loadEnv()

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), '.data', 'space-relics.db')

const outPath = path.resolve(process.argv[2] ?? path.join(process.cwd(), 'missions-export.json'))

if (!fs.existsSync(dbPath)) {
  console.log(`No legacy SQLite database at ${dbPath} — nothing to export.`)
  process.exit(0)
}

let DatabaseSync
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  console.error('Reading the legacy file needs Node 22.5+ (node:sqlite). Run this on a newer Node.')
  process.exit(1)
}

const db = new DatabaseSync(dbPath, { readOnly: true })
let rows
try {
  rows = db.prepare('SELECT * FROM missions ORDER BY created_at').all()
} finally {
  db.close()
}

const missions = rows.map((row) => ({
  id: row.id,
  sessionId: row.session_id,
  siteId: row.site_id,
  target: row.target,
  success: row.success === 1,
  partial: row.partial === 1,
  speedBudgetMps: Number(row.speed_budget_mps),
  requiredSpeedMps: Number(row.required_speed_mps),
  twr: Number(row.twr),
  weightT: Number(row.weight_t),
  stages: Number(row.stages),
  parts: JSON.parse(row.parts_json || '[]'),
  failureCode: row.failure_code ?? null,
  createdAt: row.created_at,
}))

const payload = {
  exportedAt: new Date().toISOString(),
  source: 'sqlite:.data/space-relics.db (v1 schema)',
  count: missions.length,
  missions,
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2))
console.log(`Exported ${missions.length} mission record(s) to ${outPath}.`)
console.log('Next: npm run db:import -- ' + path.basename(outPath))
