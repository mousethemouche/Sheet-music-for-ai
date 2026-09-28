/**
 * The one place where both transports run a use case (issue #19).
 *
 * - A returned failure passes through unchanged; store failures and INTERNAL
 *   are logged at error level with their (redacted) cause.
 * - A thrown value is a bug: it becomes a safe INTERNAL failure and is logged.
 * - The use case runs exactly once. Logging cannot throw, so a logging
 *   failure can neither turn a committed write into a reported failure nor
 *   cause a retry that would repeat it.
 */
import type { AppResult } from '@sheet-music/music-application';
import { internalError } from './errors';
import type { Logger } from './logger';

export async function runUseCase<T>(
  logger: Logger,
  operation: string,
  execute: () => Promise<AppResult<T>>,
): Promise<AppResult<T>> {
  let result: AppResult<T>;
  try {
    result = await execute();
  } catch (thrown) {
    logger.error('use_case.threw', { operation, error: thrown });
    return { ok: false, error: internalError(thrown) };
  }
  if (!result.ok) {
    const { code, cause } = result.error;
    if (code === 'INTERNAL' || code === 'DEPENDENCY_UNAVAILABLE') {
      logger.error('use_case.failed', { operation, code, cause });
    } else {
      logger.info('use_case.rejected', { operation, code });
    }
  }
  return result;
}
