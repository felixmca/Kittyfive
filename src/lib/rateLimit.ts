/**
 * Per-key sliding-window rate limiter, in memory.
 *
 * This is a FLOOR, not a ceiling: Vercel runs many stateless instances, so a
 * determined client can get `limit` requests per instance per window. It still
 * stops the cheap abuse (a loop hammering /api/chat with 24×2000-char prompts
 * against Claude Opus, or creating hundreds of Stripe sessions). Swap the
 * store for Upstash Ratelimit or Vercel KV when there is real traffic; the
 * call sites do not change.
 */
const MAX_KEYS = 10_000;
const windows = new Map<string, number[]>();

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, { limit, windowMs }: RateLimitOptions, now = Date.now()): RateLimitResult {
  const cutoff = now - windowMs;
  let hits = windows.get(key);
  if (!hits) {
    if (windows.size >= MAX_KEYS) {
      // Evict the oldest entry rather than growing without bound.
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
    hits = [];
    windows.set(key, hits);
  }
  while (hits.length && hits[0] <= cutoff) hits.shift();
  if (hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }
  hits.push(now);
  return { ok: true, remaining: limit - hits.length, retryAfterSec: 0 };
}

/** Best-effort client identity behind Vercel's proxy. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
  return ip;
}
