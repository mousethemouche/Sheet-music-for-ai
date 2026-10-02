import { describe, expect, it } from 'vitest';
import { DARK_QUERY, followColorScheme, type ColorSchemeQuery } from '../shell/colorScheme';

/** A MediaQueryList stand-in whose `matches` the test flips, like a system theme change. */
class FakeQuery implements ColorSchemeQuery {
  readonly listeners = new Set<() => void>();
  constructor(public matches: boolean) {}
  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'change', listener: () => void): void {
    this.listeners.delete(listener);
  }
  change(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener();
  }
}

/** The part of `document.documentElement` the function touches. */
class FakeRoot {
  readonly classes = new Set<string>(['keep-me']);
  readonly classList = {
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };
}

describe('followColorScheme (theme class of the web page)', () => {
  it('asks the system for its dark preference', () => {
    expect(DARK_QUERY).toBe('(prefers-color-scheme: dark)');
  });

  it('sets .dark only when the system prefers dark, and .light otherwise', () => {
    const dark = new FakeRoot();
    followColorScheme(dark, new FakeQuery(true));
    expect([...dark.classes].sort()).toEqual(['dark', 'keep-me']);

    const light = new FakeRoot();
    followColorScheme(light, new FakeQuery(false));
    expect([...light.classes].sort()).toEqual(['keep-me', 'light']);
  });

  it('follows a system change in both directions, never leaving both classes', () => {
    const root = new FakeRoot();
    const query = new FakeQuery(false);
    followColorScheme(root, query);

    query.change(true);
    expect(root.classes.has('dark')).toBe(true);
    expect(root.classes.has('light')).toBe(false);

    query.change(false);
    expect(root.classes.has('dark')).toBe(false);
    expect(root.classes.has('light')).toBe(true);
  });

  it('stops following once the returned function is called', () => {
    const root = new FakeRoot();
    const query = new FakeQuery(false);
    const stop = followColorScheme(root, query);
    expect(query.listeners.size).toBe(1);

    stop();
    query.change(true);

    expect(query.listeners.size).toBe(0);
    expect(root.classes.has('light')).toBe(true);
    expect(root.classes.has('dark')).toBe(false);
  });
});
