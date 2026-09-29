/**
 * Configuration of the API composition root from the environment
 * (issue #21): a valid environment is parsed with its defaults; an invalid
 * one fails before anything starts, naming every faulty variable and never
 * echoing a value (DATABASE_URL carries a password).
 */
import { describe, expect, it } from 'vitest';
import { ApiConfigError, loadApiConfig } from '../src/config';

const SECRET = 'pw-never-logged-4k';
const VALID = {
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  DATABASE_URL: `postgres://api_login:${SECRET}@db.example.test:6543/postgres`,
};

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadApiConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiConfigError);
    const configError = error as ApiConfigError;
    expect(configError.message).not.toContain(SECRET);
    return configError.problems;
  }
  throw new Error('Expected an ApiConfigError.');
}

describe('API configuration from the environment', () => {
  it('reads the required variables and applies the defaults', () => {
    expect(loadApiConfig(VALID)).toEqual({
      supabaseUrl: VALID.SUPABASE_URL,
      databaseUrl: VALID.DATABASE_URL,
      allowedOrigins: [],
      port: 3000,
    });
  });

  it('splits and trims the allowed origins and reads the port', () => {
    expect(
      loadApiConfig({
        ...VALID,
        API_ALLOWED_ORIGINS: ' https://app.example.test , http://localhost:5173 ',
        PORT: '8080',
      }),
    ).toMatchObject({
      allowedOrigins: ['https://app.example.test', 'http://localhost:5173'],
      port: 8080,
    });
  });

  it('names every missing required variable', () => {
    expect(problemsOf({ SUPABASE_URL: '  ' })).toEqual([
      'SUPABASE_URL is required.',
      'DATABASE_URL is required.',
    ]);
  });

  it('reports each invalid value without quoting it', () => {
    const problems = problemsOf({
      SUPABASE_URL: `https://user:${SECRET}@abcdefghijklmnopqrst.supabase.co/auth/v1`,
      DATABASE_URL: `mysql://api_login:${SECRET}@db.example.test/postgres`,
      API_ALLOWED_ORIGINS: 'https://app.example.test/',
      PORT: '70000',
    });

    expect(problems.map((problem) => problem.split(' ')[0])).toEqual([
      'SUPABASE_URL',
      'DATABASE_URL',
      'API_ALLOWED_ORIGINS',
      'PORT',
    ]);
    expect(problems.join(' ')).not.toContain(SECRET);
    expect(problems.join(' ')).not.toContain('app.example.test');
  });
});
