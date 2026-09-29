/**
 * Synthetic accounts of the cloud suites: one fresh address per run on the
 * configured mail-sink mailbox (`<local>+smfa-<suite>-<time>-<random>@<domain>`)
 * and random passwords. No real tester address, no production account; the
 * suites delete the account they create.
 */
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import type { Mailbox } from './env';

export type RandomBytes = (size: number) => Uint8Array;

export interface SyntheticIdentity {
  /** `smfa-<suite>-<yyyymmddhhmmss>-<hex>`: also used to name what the run creates. */
  readonly tag: string;
  readonly email: string;
  readonly password: string;
}

/** 24 random base64url characters between fixed upper-case, digit and symbol parts. */
export function newPassword(randomBytes: RandomBytes = nodeRandomBytes): string {
  return `Smfa-${Buffer.from(randomBytes(18)).toString('base64url')}-9!`;
}

export function syntheticIdentity(
  mailbox: Mailbox,
  suite: string,
  now: Date,
  randomBytes: RandomBytes = nodeRandomBytes,
): SyntheticIdentity {
  if (!/^[a-z0-9-]{1,16}$/.test(suite)) throw new TypeError(`Invalid suite label "${suite}"`);
  const time = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const tag = `smfa-${suite}-${time}-${Buffer.from(randomBytes(3)).toString('hex')}`;
  return {
    tag,
    email: `${mailbox.local}+${tag}@${mailbox.domain}`,
    password: newPassword(randomBytes),
  };
}
