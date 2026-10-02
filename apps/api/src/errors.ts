/**
 * Error handling of the HTTP adapter (issue #19, ERRORS_AND_SECURITY.md §1.3,
 * §5 item 2). Every failure leaves through server-common's `sendError`: the
 * status comes from the shared ERROR_MAPPING and the body is the safe
 * envelope `{ code, message, details?, correlationId }`, JSON with `nosniff`
 * and `Cache-Control: no-store`. Nothing thrown by Nest, Express or a bug is
 * ever serialized as is (no HTML page, no stack, no request text).
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  type PipeTransform,
} from '@nestjs/common';
import { type AppResult, applicationError } from '@sheet-music/music-application';
import { inputIssueDetails } from '@sheet-music/music-contracts';
import {
  type Logger,
  type ServerError,
  internalError,
  sendError,
} from '@sheet-music/server-common';
import type { Response } from 'express';

/** An expected failure with its safe error and extra response headers (for example WWW-Authenticate). */
export class ApiFailure extends Error {
  constructor(
    readonly failure: ServerError,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(failure.message);
    this.name = 'ApiFailure';
  }
}

/** The value of a successful use case; a returned failure becomes an ApiFailure. */
export function unwrap<T>(result: AppResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new ApiFailure(result.error);
}

const ROUTE_NOT_FOUND = applicationError('NOT_FOUND', [], 'No route matches this method and path.');
const MALFORMED_REQUEST = applicationError('INVALID_INPUT', [], 'The request is malformed.');

/**
 * The global filter. Expected failures (ApiFailure) keep their code and
 * headers. Nest's own 404 (no route for this method and path) and 400
 * (a path with an invalid percent-encoding, mapped by the Express adapter)
 * become safe envelopes without Nest's message, which quotes the request.
 * Anything else is a bug: logged, answered INTERNAL.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiFailure) {
      sendError(res, exception.failure, exception.headers);
      return;
    }
    const status = exception instanceof HttpException ? exception.getStatus() : undefined;
    if (status === 404) {
      sendError(res, ROUTE_NOT_FOUND);
      return;
    }
    if (status === 400) {
      sendError(res, MALFORMED_REQUEST);
      return;
    }
    this.logger.error('http.unexpected_error', { error: exception });
    sendError(res, internalError(exception));
  }
}

type ContractError = Parameters<typeof inputIssueDetails>[0];

/** A music-contracts schema, seen through its `safeParse` only (apps/api does not depend on zod). */
export interface Contract<T> {
  safeParse(
    input: unknown,
  ):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: ContractError };
}

/**
 * Validates a query string or path parameters with a music-contracts schema.
 * A failure is INVALID_INPUT (400) with the contract's safe details, whose
 * paths name the offending parameter.
 */
export class ContractPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly contract: Contract<T>) {}

  transform(value: unknown): T {
    const parsed = this.contract.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    throw new ApiFailure(applicationError('INVALID_INPUT', inputIssueDetails(parsed.error)));
  }
}
