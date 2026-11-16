// Shared, server-side rate limiting for the public API.
//
// Two backends, chosen at runtime:
//   • Upstash Redis (when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
//     set) — a sliding window shared by every function instance. This is the
//     only mode that truly protects the deployment as a whole.
//   • A bounded in-memory fixed window as a production-safe fallback when Redis
//     is not configured, so a single instance still cannot be hammered and the
//     API degrades rather than failing open completely.
//
// Identifiers are SHA-256 hashed before they leave the process, so no raw IP is
// stored in Redis.
import { createHash } from 'node:crypto'
import { Ratelimit } from '@upstash/ratelimit'
import { fail, PUBLIC_CORS_HEADERS } from './http'
import { sharedRedis } from './redis'

export type PolicyName = 'read' | 'missionsRead' | 'missionsWrite'

type Policy = { limit: number; windowSeconds: number }

/** Generous enough for ordinary browsing; strict where writes hit the database. */
const POLICIES: Record<PolicyName, Policy> = {
  read: { limit: 120, windowSeconds: 60 },
  missionsRead: { limit: 60, windowSeconds: 60 },
  missionsWrite: { limit: 10, windowSeconds: 60 },
}

const redis = sharedRedis()

/** `upstash` when shared limiting is configured, otherwise `memory`. */
export const rateLimitMode: 'upstash' | 'memory' = redis ? 'upstash' : 'memory'

const limiters = new Map<PolicyName, Ratelimit>()
let warnedAboutFallback = false

function limiter(name: PolicyName): Ratelimit | null {
  if (!redis) return null
  const cached = limiters.get(name)
  if (cached) return cached
  const policy = POLICIES[name]
  const created = new Ratelimit({
    redis,
    prefix: `space-relics:${name}`,
    limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
    analytics: false,
  })
  limiters.set(name, created)
  return created
}

type MemoryBucket = { count: number; resetAt: number }
const buckets = new Map<string, MemoryBucket>()

function memoryLimit(name: PolicyName, identifier: string, now: number) {
  const policy = POLICIES[name]
  if (buckets.size > 5000) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
    if (buckets.size > 5000) buckets.clear()
  }
  const key = `${name}:${identifier}`
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + policy.windowSeconds * 1000 }
    buckets.set(key, bucket)
    return { allowed: true, limit: policy.limit, remaining: policy.limit - 1, reset: bucket.resetAt }
  }
  existing.count += 1
  return {
    allowed: existing.count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - existing.count),
    reset: existing.resetAt,
  }
}

export type RateLimitDecision = {
  allowed: boolean
  limit: number
  remaining: number
  reset: number
}

async function checkLimit(name: PolicyName, identifier: string): Promise<RateLimitDecision> {
  const upstash = limiter(name)
  if (upstash) {
    try {
      const result = await upstash.limit(identifier)
      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      }
    } catch {
      // Redis unreachable: never take the whole site down with it.
      if (!warnedAboutFallback) {
        warnedAboutFallback = true
        console.warn('[rate-limit] shared limiter unavailable, using in-memory fallback')
      }
    }
  }
  return memoryLimit(name, identifier, Date.now())
}

/**
 * Client address as seen by the platform. Vercel sets these at the edge and
 * strips client-supplied values; locally they are absent, which is fine.
 */
export function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')
  if (real && real.trim()) return real.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

function headerRecord(decision: RateLimitDecision): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Reset': String(Math.ceil(decision.reset / 1000)),
  }
}

export type RateLimitGate = { blocked: Response | null; headers: Record<string, string> }

/**
 * Applies the named policy to the caller.
 *
 * Returns a ready 429 response when the limit is exceeded, plus the headers a
 * successful response should echo. Nothing is required from the caller beyond
 * the route handler.
 */
export async function guardRateLimit(
  request: Request,
  name: PolicyName,
  /** Public read endpoints must still expose their CORS policy on a 429. */
  cors = false,
): Promise<RateLimitGate> {
  const decision = await checkLimit(name, hashIdentifier(clientIp(request)))
  const headers = headerRecord(decision)
  if (decision.allowed) return { blocked: null, headers }

  const retryAfter = Math.max(1, Math.ceil((decision.reset - Date.now()) / 1000))
  const blocked = fail(
    429,
    'rate_limited',
    'Too many requests. Please try again shortly.',
    undefined,
    {
      ...(cors ? PUBLIC_CORS_HEADERS : {}),
      ...headers,
      'Retry-After': String(retryAfter),
      'Cache-Control': 'no-store',
    },
  )
  return { blocked, headers }
}
