/**
 * Test double of the RateLimitStore contract (ERRORS_AND_SECURITY.md §3.3):
 * fixed windows aligned on multiples of `windowMs` since the Unix epoch.
 * Instance-local, so it is NOT production protection; the shared Postgres
 * store is verified by the SEC-03 integration test of the wiring phase.
 */
import type { RateLimitStore, RateLimitWindow } from '../../src/index';

export class FixedWindowTestStore implements RateLimitStore {
  private readonly counters = new Map<string, { start: number; count: number }>();
  readonly keys: string[] = [];
  failing = false;

  hit(key: string, windowMs: number, now: Date): Promise<RateLimitWindow> {
    if (this.failing) {
      return Promise.reject(new Error('rate-limit store unavailable'));
    }
    this.keys.push(key);
    const start = Math.floor(now.getTime() / windowMs) * windowMs;
    const current = this.counters.get(key);
    const count = current !== undefined && current.start === start ? current.count + 1 : 1;
    this.counters.set(key, { start, count });
    return Promise.resolve({
      count,
      windowStartedAt: new Date(start),
      resetAt: new Date(start + windowMs),
    });
  }
}
