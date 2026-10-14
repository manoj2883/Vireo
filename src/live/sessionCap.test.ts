import { describe, expect, it } from 'vitest';
import { MAX_SESSION_MS, sessionCap } from './sessionCap';

describe('the ten-minute session cap', () => {
  it('is ten minutes', () => expect(MAX_SESSION_MS).toBe(600_000));

  it('warns in the last minute and stops at ten', () => {
    expect(sessionCap(8 * 60_000)).toEqual({ leftMs: 120_000, warn: false, over: false });
    expect(sessionCap(9 * 60_000 + 1)).toMatchObject({ warn: true, over: false });
    expect(sessionCap(10 * 60_000)).toEqual({ leftMs: 0, warn: false, over: true });
    expect(sessionCap(11 * 60_000).over).toBe(true);
  });
});
