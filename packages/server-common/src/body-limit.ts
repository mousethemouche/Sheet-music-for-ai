/**
 * Request-body cap (issue #24, ERRORS_AND_SECURITY.md §3.1). Mounted before
 * any body parser; it reads nothing itself.
 *
 * - A declared `Content-Length` above the cap is answered 413 at once,
 *   before a single body byte is read or parsed.
 * - A body without a declared length (`Transfer-Encoding: chunked`) is
 *   answered 411: every accepted body has a declared length, and Node's HTTP
 *   parser never delivers more bytes than declared, so the cap cannot be
 *   bypassed by streaming. (A request carrying both headers is already
 *   refused by Node's parser.)
 * Rejections close the connection so the unread body is not drained.
 */
import { PAYLOAD_LIMITS } from '@sheet-music/music-contracts';
import type { RequestHandler } from 'express';
import { transportError } from './errors';
import { sendError } from './http';

export interface BodySizeLimitOptions {
  /** Default: PAYLOAD_LIMITS.requestBodyBytes (512 KiB). */
  readonly maxBytes?: number;
}

export function bodySizeLimit(options: BodySizeLimitOptions = {}): RequestHandler {
  const maxBytes = options.maxBytes ?? PAYLOAD_LIMITS.requestBodyBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('maxBytes must be a positive integer.');
  }
  const tooLarge = transportError(
    'PAYLOAD_TOO_LARGE',
    `The request body is too large: the limit is ${maxBytes} bytes.`,
  );
  return (req, res, next) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined) {
      if (Number(declared) > maxBytes) {
        sendError(res, tooLarge, { Connection: 'close' });
        return;
      }
      next();
      return;
    }
    if (req.headers['transfer-encoding'] !== undefined) {
      sendError(res, transportError('LENGTH_REQUIRED'), { Connection: 'close' });
      return;
    }
    next();
  };
}
