/**
 * Request protection of apps/api (issues #19 and #24, ERRORS_AND_SECURITY.md
 * §3), in the documented order:
 *
 *   correlation -> Origin policy -> body cap -> per-IP rate limit
 *     -> authentication (SessionAuthGuard) -> per-owner rate limit -> handler
 *
 * The first three run for every request, before routing, so a forbidden
 * Origin, a CORS preflight or an oversized body is answered before any 404
 * and before any work. The per-IP limit covers the private routes only
 * (`/scores`), before token verification; health and version stay free of
 * any database dependency. The per-owner limit is a guard that runs after
 * the auth guard, on the verified UserId.
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { applicationError } from '@sheet-music/music-application';
import {
  type Logger,
  type RateLimitDecision,
  type RateLimitRule,
  type RateLimitStore,
  bodySizeLimit,
  checkRule,
  clientAddress,
  consumeRateLimit,
  correlationMiddleware,
  originPolicy,
  rateLimit,
  transportError,
} from '@sheet-music/server-common';
import type { Request, RequestHandler } from 'express';
import { principalOf } from './auth';
import { ApiFailure } from './errors';

/** Path prefix of the private saved-library routes. */
export const PRIVATE_PREFIX = '/scores';

export const DEFAULT_IP_RULE: RateLimitRule = { name: 'api-ip', limit: 300, windowMs: 60_000 };
export const DEFAULT_OWNER_RULE: RateLimitRule = {
  name: 'api-owner',
  limit: 120,
  windowMs: 60_000,
};

export interface ApiRateLimitOptions {
  /** Per client address, before authentication. Default DEFAULT_IP_RULE. */
  readonly perIp?: RateLimitRule;
  /** Per verified UserId, after authentication. Default DEFAULT_OWNER_RULE. */
  readonly perOwner?: RateLimitRule;
  /** Clock of both limits. Default: system time. */
  readonly now?: () => Date;
}

const noSniff: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

/** Correlation, nosniff, Origin/CORS and body cap: mounted first, for every method and path. */
export function apiRequestProtection(allowedOrigins: readonly string[]): RequestHandler[] {
  return [
    correlationMiddleware(),
    noSniff,
    originPolicy({
      allowedOrigins,
      allowedMethods: ['GET'],
      allowedHeaders: ['authorization', 'x-correlation-id'],
      exposedHeaders: ['www-authenticate', 'x-correlation-id', 'retry-after'],
    }),
    bodySizeLimit(),
  ];
}

/** The per-IP limit of the private routes (fails closed with 503 when the store is down). */
export function ipRateLimit(
  store: RateLimitStore,
  logger: Logger,
  options: ApiRateLimitOptions = {},
): RequestHandler {
  return rateLimit({
    store,
    rule: options.perIp ?? DEFAULT_IP_RULE,
    subject: (req: Request) => clientAddress(req),
    logger,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

/**
 * The per-owner limit, as a guard after SessionAuthGuard: 429 with
 * `Retry-After` over the limit, 503 when the store fails; the handler never
 * runs in either case. Public routes (no principal) are not counted.
 */
export class OwnerRateLimitGuard implements CanActivate {
  private readonly rule: RateLimitRule;
  private readonly now: () => Date;

  constructor(
    private readonly store: RateLimitStore,
    private readonly logger: Logger,
    options: ApiRateLimitOptions = {},
  ) {
    this.rule = checkRule(options.perOwner ?? DEFAULT_OWNER_RULE);
    this.now = options.now ?? (() => new Date());
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = principalOf(context.switchToHttp().getRequest<Request>());
    if (principal === undefined) {
      return true;
    }
    let decision: RateLimitDecision;
    try {
      decision = await consumeRateLimit(this.store, this.rule, principal.userId, this.now());
    } catch (error) {
      this.logger.error('rate_limit.store_failed', { rule: this.rule.name, error });
      throw new ApiFailure(
        applicationError(
          'DEPENDENCY_UNAVAILABLE',
          [],
          'Request limiting is temporarily unavailable. Retry later.',
          error,
        ),
      );
    }
    if (!decision.allowed) {
      throw new ApiFailure(transportError('RATE_LIMITED'), {
        'Retry-After': String(decision.retryAfterSeconds),
      });
    }
    return true;
  }
}
