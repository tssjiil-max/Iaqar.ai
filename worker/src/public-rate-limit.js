/**
 * Phase 8 — rate limiting helpers for unauthenticated public intake/media routes.
 * Pure evaluation is unit-tested; the Worker holds an in-memory sliding window.
 */

export const PUBLIC_RATE_LIMITS = Object.freeze({
  PUBLIC_INTAKE: Object.freeze({ limit: 30, windowMs: 60_000 }),
  PUBLIC_MEDIA: Object.freeze({ limit: 60, windowMs: 60_000 }),
  PUBLIC_VOICE: Object.freeze({ limit: 20, windowMs: 60_000 })
});

/**
 * Evaluate a sliding-window counter.
 * @param {{ count?: number, windowStart?: number }} state
 * @param {{ now?: number, limit?: number, windowMs?: number }} opts
 */
export function evaluatePublicRateLimit(state = {}, {
  now = Date.now(),
  limit = PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit,
  windowMs = PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.windowMs
} = {}) {
  const prevCount = Number(state.count || 0);
  const prevStart = Number(state.windowStart || 0);
  const inWindow = prevStart > 0 && (now - prevStart) < windowMs;
  const windowStart = inWindow ? prevStart : now;
  const count = (inWindow ? prevCount : 0) + 1;
  const allowed = count <= limit;
  const retryAfterMs = allowed ? 0 : Math.max(0, (windowStart + windowMs) - now);
  return {
    ok: allowed,
    nextState: { count, windowStart },
    retryAfterSec: Math.ceil(retryAfterMs / 1000),
    limit,
    windowMs
  };
}

/** In-memory store shared across requests in one Worker isolate. */
const buckets = new Map();

export function resetPublicRateLimitStoreForTests() {
  buckets.clear();
}

export function consumePublicRateLimit(key, {
  now = Date.now(),
  limit = PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit,
  windowMs = PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.windowMs
} = {}) {
  const current = buckets.get(key) || { count: 0, windowStart: 0 };
  const result = evaluatePublicRateLimit(current, { now, limit, windowMs });
  buckets.set(key, result.nextState);
  return result;
}

export function publicRateLimitKey({ route, ip = "unknown", officeId = "" }) {
  return [String(route || ""), String(ip || "unknown"), String(officeId || "")].join("|");
}
