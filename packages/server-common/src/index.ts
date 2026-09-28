/**
 * @sheet-music/server-common
 *
 * Server infrastructure shared by apps/api and apps/mcp (issues #19, #24):
 * the error mapping to HTTP and MCP, correlation and structured redacted
 * logging, and request protection (body cap, Origin policy, rate limiting).
 * See docs/architecture/ERRORS_AND_SECURITY.md.
 */
export { type BodySizeLimitOptions, bodySizeLimit } from './body-limit';
export {
  type RequestContext,
  CORRELATION_HEADER,
  correlationMiddleware,
  currentRequestContext,
  readClientCorrelationId,
  runWithRequestContext,
} from './context';
export {
  type ErrorMapping,
  type HttpErrorResponse,
  type McpDisposition,
  type McpToolErrorResult,
  type ServerError,
  type ServerErrorCode,
  type ServerErrorEnvelope,
  type TransportErrorCode,
  ERROR_MAPPING,
  TRANSPORT_ERROR_CODES,
  internalError,
  toErrorEnvelope,
  toHttpError,
  toMcpToolError,
  transportError,
} from './errors';
export { JSON_CONTENT_TYPE, sendError } from './http';
export {
  type LogFields,
  type LogLevel,
  type Logger,
  type LoggerOptions,
  LOG_LEVELS,
  createLogger,
} from './logger';
export { type OriginPolicyOptions, originPolicy } from './origin';
export {
  type RateLimitDecision,
  type RateLimitOptions,
  type RateLimitRule,
  type RateLimitStore,
  type RateLimitWindow,
  checkRule,
  clientAddress,
  consumeRateLimit,
  rateLimit,
} from './rate-limit';
export { type RedactOptions, REDACTED, redact, redactString } from './redact';
export { runUseCase } from './use-case';
