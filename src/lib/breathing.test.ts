import { describe, expect, it } from 'vitest';
import { breathPhase, IN_MS, OUT_MS } from './breathing';

describe('breathing pace', () => {
  it('breathes in for 4 s, out for 6 s, and repeats', () => {
    expect(breathPhase(0)).toBe('in');
    expect(breathPhase(IN_MS - 1)).toBe('in');
    expect(breathPhase(IN_MS)).toBe('out');
    expect(breathPhase(IN_MS + OUT_MS - 1)).toBe('out');
    expect(breathPhase(IN_MS + OUT_MS)).toBe('in');
  });
});
