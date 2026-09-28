/**
 * The test harness drops the database it is given (DROP DATABASE ... WITH
 * (FORCE)), so it must refuse every name outside the `sheet_music_*` test
 * namespace before it connects anywhere (REPO_LAYOUT.md "Test categories").
 */
import { describe, expect, it } from 'vitest';
import { assertTestDatabaseName, createTestDatabase } from '../../testing';

describe('test database name guard', () => {
  it.each([
    { name: 'postgres' },
    { name: 'template1' },
    { name: 'sheet_music' },
    { name: 'sheet_music_' },
    { name: 'Sheet_music_test' },
    { name: 'sheet_music_Test' },
    { name: 'sheet_music_test-rls' },
    { name: 'sheet_music_test"; drop database postgres; --' },
    { name: `sheet_music_${'a'.repeat(52)}` },
    { name: 'prod_sheet_music_test' },
  ])('refuses "$name"', async ({ name }) => {
    expect(() => assertTestDatabaseName(name)).toThrow(/^Refusing to use database/);
    // Refused before any connection: no TEST_DATABASE_URL is needed to reach the guard.
    await expect(createTestDatabase(name)).rejects.toThrow(/^Refusing to use database/);
  });

  it.each([
    { name: 'sheet_music_test' },
    { name: 'sheet_music_test_rls' },
    { name: `sheet_music_${'a'.repeat(51)}` },
  ])('accepts "$name"', ({ name }) => {
    expect(() => assertTestDatabaseName(name)).not.toThrow();
  });
});
