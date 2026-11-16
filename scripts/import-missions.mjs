// Import a legacy export into PostgreSQL (Neon).
//
//   npm run db:import                         reads missions-export.json
//   npm run db:import -- other-export.json
//
// Safe to run more than once: rows are matched by primary key, so an existing
// mission is never duplicated and never overwritten.
import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'
import { migrateUp } from '../lib/migrations.mjs'
import { loadEnv, requireDatabaseUrl } from './env.mjs'

loadEnv()

const inPath = path.resolve(process.argv[2] ?? path.join(process.cwd(), 'missions-export.json'))
if (!fs.existsSync(inPath)) {
  console.error(`No export file at ${inPath}. Run \`npm run db:export-sqlite\` first.`)
  process.exit(1)
}

const payload = JSON.parse(fs.readFileSync(inPath, 'utf8'))
const missions = Array.isArray(payload?.missions) ? payload.missions : []
if (!missions.length) {
  console.log('The export contains no missions — nothing to import.')
  process.exit(0)
}

const sql = neon(requireDatabaseUrl())
await migrateUp(sql)

let inserted = 0
let skipped = 0

for (const mission of missions) {
  if (typeof mission?.id !== 'string' || typeof mission?.sessionId !== 'string') {
    skipped += 1
    continue
  }
  const rows = await sql`
    INSERT INTO missions (
      id, session_id, site_id, site_name, target, success, partial,
      speed_budget_mps, required_speed_mps, twr, weight_t, stages,
      parts_json, failure_code, created_at
    ) VALUES (
      ${mission.id}, ${mission.sessionId}, ${mission.siteId},
      ${mission.siteName ?? mission.siteId}, ${mission.target},
      ${mission.success === true}, ${mission.partial === true},
      ${Number(mission.speedBudgetMps) || 0}, ${Number(mission.requiredSpeedMps) || 0},
      ${Number(mission.twr) || 0}, ${Number(mission.weightT) || 0},
      ${Number(mission.stages) || 0}, ${JSON.stringify(mission.parts ?? [])},
      ${mission.failureCode ?? null}, ${mission.createdAt ?? new Date().toISOString()}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  if (rows.length) inserted += 1
  else skipped += 1
}

console.log(`Imported ${inserted} mission record(s); ${skipped} already present or unusable.`)
