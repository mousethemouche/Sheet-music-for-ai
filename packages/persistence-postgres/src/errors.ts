/**
 * Storage failures of the Postgres adapter (APPLICATION_LAYER.md §3.1).
 *
 * Every infrastructure failure (connection refused or lost, timeout, SQL or
 * constraint error, failed commit) rejects with a PersistenceError, which the
 * use cases report as DEPENDENCY_UNAVAILABLE. A storage failure is never turned
 * into a null row, a 'stale' outcome or an empty page. StoredScoreUnreadableError
 * (a stored ScoreSpec this build cannot read) is thrown as is, never wrapped,
 * so the use cases can report it as INTERNAL.
 */

export class PersistenceError extends Error {
  /** The port method that failed, for example "drafts.update". */
  readonly operation: string;
  /** SQLSTATE of the PostgreSQL error, when the server reported one (logged by server-common). */
  readonly code?: string;

  constructor(operation: string, cause: unknown) {
    // The message never includes the driver's message or detail, which can quote row values.
    super(`PostgreSQL operation ${operation} failed.`, { cause });
    this.name = 'PersistenceError';
    this.operation = operation;
    const code = sqlState(cause);
    if (code !== undefined) {
      this.code = code;
    }
  }
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}
