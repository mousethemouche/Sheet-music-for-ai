/**
 * Fixed-window rate limiting over a shared store (issue #24,
 * ERRORS_AND_SECURITY.md §3.3).
 *
 * `RateLimitStore` is a structural contract implemented by
 * persistence-postgres (a table shared by every instance, so the limit holds
 * across serverless instances); neither package imports the other. There is
 * deliberately no in-memory store here: an instance-local counter is not a
 * limit on a horizontally scaled deployment.
 *
 * Mount one middleware per rule: a per-IP rule before authentication (it
 * protects token verification too) and a per-owner rule after it.
 */
import { applicationError } from '@sheet-music/music-application';
import type { Request, RequestHandler, Response } from 'express';
import { transportError } from './errors';
import { sendError } from './http';
import type { Logger } from './logger';

export interface RateLimitWindow {
  /** Hits counted in the window containing `now`, this one included. */
  readonly count: number;
  readonly windowStartedAt: Date;
  /** End of the window: the counter restarts at this instant. */
  readonly resetAt: Date;
}

export interface RateLimitStore {
  /**
   * Atomically increments the counter of the fixed window containing `now` for
   * `key` and returns the post-increment count. Windows are aligned on
   * multiples of `windowMs` since the Unix epoch: [floor(now / windowMs) *
   * windowMs, that + windowMs). `windowMs` is any window `checkRule` accepts
   * (the Postgres store takes it as a bigint). Rejects when the store is
   * unavailable.
   */
  hit(key: string, windowMs: number, now: Date): Promise<RateLimitWindow>;
}

export interface RateLimitRule {
  /** Namespaces the keys, so an owner ID and an IP address never share a counter. */
  readonly name: string;
  /** Requests allowed per window. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly count: number;
  readonly limit: number;
  readonly resetAt: Date;
  /** Whole seconds until the window resets, at least 1. */
  readonly retryAfterSeconds: number;
}

const RULE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

export function checkRule(rule: RateLimitRule): RateLimitRule {
  if (!RULE_NAME.test(rule.name)) {
    throw new TypeError('A rate-limit rule name is 1-32 lowercase letters, digits, "_" or "-".');
  }
  if (!Number.isSafeInteger(rule.limit) || rule.limit <= 0) {
    throw new RangeError('A rate-limit rule limit must be a positive integer.');
  }
  if (!Number.isSafeInteger(rule.windowMs) || rule.windowMs <= 0) {
    throw new RangeError('A rate-limit rule window must be a positive integer of milliseconds.');
  }
  return rule;
}

/** Counts one request of `subject` under `rule` and decides whether it may proceed. */
export async function consumeRateLimit(
  store: RateLimitStore,
  rule: RateLimitRule,
  subject: string,
  now: Date,
): Promise<RateLimitDecision> {
  const window = await store.hit(`${rule.name}:${subject}`, rule.windowMs, now);
  return {
    allowed: window.count <= rule.limit,
    count: window.count,
    limit: rule.limit,
    resetAt: window.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt.getTime() - now.getTime()) / 1000)),
  };
}

export interface RateLimitOptions {
  readonly store: RateLimitStore;
  readonly rule: RateLimitRule;
  /**
   * The counted subject of a request: the client address for a per-IP rule,
   * the authenticated UserId for a per-owner rule. `undefined` skips the rule
   * for this request (for example no principal on a public route).
   */
  readonly subject: (req: Request, res: Response) => string | undefined;
  /** Receives store failures (the client only sees a 503). */
  readonly logger: Logger;
  readonly now?: () => Date;
}

/**
 * Over the limit: 429 with `Retry-After`, and the handler (and its writes)
 * never runs. Store failure: 503 (fail closed), never an unlimited pass.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const rule = checkRule(options.rule);
  const now = options.now ?? (() => new Date());
  return async (req, res, next) => {
    const subject = options.subject(req, res);
    if (subject === undefined) {
      next();
      return;
    }
    let decision: RateLimitDecision;
    try {
      decision = await consumeRateLimit(options.store, rule, subject, now());
    } catch (error) {
      options.logger.error('rate_limit.store_failed', { rule: rule.name, error });
      sendError(
        res,
        applicationError(
          'DEPENDENCY_UNAVAILABLE',
          [],
          'Request limiting is temporarily unavailable. Retry later.',
          error,
        ),
      );
      return;
    }
    if (!decision.allowed) {
      sendError(res, transportError('RATE_LIMITED'), {
        'Retry-After': String(decision.retryAfterSeconds),
      });
      return;
    }
    next();
  };
}

/**
 * The client address as Express resolves it. Behind a proxy (Vercel, a load
 * balancer) the app MUST set `trust proxy` to the proxy hops; otherwise every
 * client shares the proxy's address and one per-IP counter.
 */
export function clientAddress(req: Request): string | undefined {
  return req.ip;
}
