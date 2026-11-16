import { isDatabaseConfigured, pingDatabase } from '@/lib/db'
import { fail, ok } from '@/lib/http'
import { relicCounts } from '@/lib/relics'
import type { HealthReport } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Minimal service status: is the app reachable, is storage available, is the
 * public dataset readable, how long did the probe take.
 *
 * Deliberately excluded: connection strings, database or filesystem paths,
 * environment values, stack traces, and any global mission or user statistic.
 */
export async function GET() {
  const started = Date.now()
  const checks: HealthReport['checks'] = {
    database: { ok: false, detail: 'unavailable' },
    relicData: { ok: false, records: 0 },
  }

  try {
    await pingDatabase()
    checks.database = { ok: true, detail: 'available' }
  } catch {
    checks.database = { ok: false, detail: isDatabaseConfigured() ? 'unavailable' : 'not configured' }
  }

  try {
    const counts = await relicCounts()
    checks.relicData = { ok: counts.total > 0, records: counts.total }
  } catch {
    checks.relicData = { ok: false, records: 0 }
  }

  const report: HealthReport = {
    status: checks.database.ok && checks.relicData.ok ? 'ok' : 'degraded',
    service: 'space-relics-api',
    time: new Date().toISOString(),
    latencyMs: Date.now() - started,
    checks,
  }

  if (report.status !== 'ok') {
    return fail(503, 'degraded', 'The backend is reachable but not fully healthy.', { data: report })
  }
  return ok(report)
}
