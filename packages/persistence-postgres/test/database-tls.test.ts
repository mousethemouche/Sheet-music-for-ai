/**
 * TLS of the servers' database connection (DATABASE.md §10.2): TLS is set by
 * DATABASE_CA_CERT only and is then always verified; DATABASE_URL carries no
 * TLS parameter (node-postgres lets it override the `ssl` option); without a
 * CA only a loopback database is accepted. Problems name the variables,
 * never a value.
 */
import { describe, expect, it } from 'vitest';
import { databaseTls, databaseTlsProblems } from '../src';
import { TEST_DATABASE_CA_CERT } from '../testing';

const PASSWORD = 'pw-never-quoted-5r';
const POOLER = `postgres://postgres.abcdefghijklmnopqrst:${PASSWORD}@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`;
const CA_REQUIRED =
  'DATABASE_CA_CERT is required for a database outside the loopback host: the PEM certificate of the database CA, for verified TLS.';
const URL_TLS =
  'DATABASE_URL must not carry TLS parameters (sslmode, sslrootcert, ...): TLS is set by DATABASE_CA_CERT, which URL parameters would override.';
const NOT_PEM = 'DATABASE_CA_CERT must be a PEM certificate.';

describe('database TLS settings', () => {
  it.each([
    `postgres://user:${PASSWORD}@localhost:5432/sheet_music_test`,
    'postgresql://user@127.0.0.1:5433/sheet_music_test',
    'postgres://user@[::1]:5432/sheet_music_test',
    'postgres://user@LOCALHOST/sheet_music_test',
    'postgres:///sheet_music_test?host=/var/run/postgresql',
  ])('accepts a loopback database without a CA: %s', (url) => {
    expect(databaseTlsProblems(url, undefined)).toEqual([]);
  });

  it.each([
    POOLER,
    `postgres://login:${PASSWORD}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`,
    `postgres://user:${PASSWORD}@localhost:5432/postgres?host=db.example.org`,
  ])('requires DATABASE_CA_CERT for any other host: %s', (url) => {
    expect(databaseTlsProblems(url, undefined)).toEqual([CA_REQUIRED]);
  });

  it.each([
    'sslmode=no-verify',
    'sslmode=require',
    'sslmode=verify-full',
    'sslrootcert=/etc/ssl/supabase.crt',
    'ssl=true',
    'sslnegotiation=direct',
    'uselibpqcompat=true',
  ])('refuses the URL parameter %s, even with a CA', (parameter) => {
    expect(databaseTlsProblems(`${POOLER}?${parameter}`, TEST_DATABASE_CA_CERT)).toEqual([URL_TLS]);
    expect(
      databaseTlsProblems(`postgres://user@localhost/sheet_music_test?${parameter}`, undefined),
    ).toEqual([URL_TLS]);
  });

  it.each([
    ['plain text', 'supabase root certificate'],
    ['a truncated certificate', TEST_DATABASE_CA_CERT.slice(0, 200)],
    [
      'a private key',
      '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----',
    ],
  ])('refuses %s as DATABASE_CA_CERT', (_label, value) => {
    expect(databaseTlsProblems(POOLER, value)).toEqual([NOT_PEM]);
  });

  it('accepts a remote database with a PEM CA and no TLS parameter in the URL', () => {
    expect(databaseTlsProblems(POOLER, TEST_DATABASE_CA_CERT)).toEqual([]);
  });

  it('reports every problem at once without quoting a value', () => {
    const problems = databaseTlsProblems(`${POOLER}?sslmode=no-verify`, undefined);

    expect(problems).toEqual([URL_TLS, CA_REQUIRED]);
    expect(problems.join(' ')).not.toContain(PASSWORD);
    expect(problems.join(' ')).not.toContain('pooler.supabase.com');
  });

  it('builds verified TLS options from a CA and none without one', () => {
    expect(databaseTls(TEST_DATABASE_CA_CERT)).toEqual({
      ssl: { ca: TEST_DATABASE_CA_CERT, rejectUnauthorized: true },
    });
    expect(databaseTls(undefined)).toEqual({});
  });
});
