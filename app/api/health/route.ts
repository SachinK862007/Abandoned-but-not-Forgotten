import { isDatabaseConfigured, pingDatabase } from '@/lib/db'
import { fail, ok } from '@/lib/http'
import { rateLimitStatus } from '@/lib/rate-limit'
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
    rateLimit: { ok: false, mode: 'memory', detail: 'not checked' },
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

  // Report the rate-limit backend truthfully. In-memory limiting is a
  // per-instance fallback, not deployment-wide enforcement, so it is flagged as
  // degraded only when it is the *only* option for a hosted deployment (where
  // Upstash is expected). Locally, memory mode is the intended default and does
  // not fail the health check on its own.
  const rl = rateLimitStatus()
  const hosted = Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.CF_PAGES)
  const shared = rl.mode === 'upstash'
  checks.rateLimit = {
    ok: shared,
    mode: rl.mode,
    detail: shared
      ? 'shared (upstash)'
      : rl.mode === 'upstash-degraded'
        ? 'shared store unavailable; per-instance fallback'
        : 'in-memory fallback; not shared between instances',
  }

  const report: HealthReport = {
    status: checks.database.ok && checks.relicData.ok && !(hosted && !shared) ? 'ok' : 'degraded',
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
