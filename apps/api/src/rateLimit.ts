/** Fixed-window, in-memory rate limiter (single API instance). */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  hit(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    if (this.windows.size > 10_000) this.prune(now);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return { allowed: w.count <= this.limit, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
  }

  private prune(now: number) {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}
