// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CONTEXT_RULE, describeSpeakingContext, sanitizeSpeakingContext } from './context.js';
import { buildFieldNotesPrompt, FIELD_NOTES_SYSTEM } from './prompt.js';
import { buildTightenPrompt, TIGHTEN_SYSTEM } from './tighten.js';

const lines = [{ speaker: 'user', text: 'My research is about refusal.', startMs: 0 }];

describe('speaking context', () => {
  it('keeps only valid, trimmed fields', () => {
    expect(sanitizeSpeakingContext({ audience: '  Investors  ', goal: 'persuade', stakes: 'critical' })).toEqual({ audience: 'Investors', goal: 'persuade', stakes: 'critical' });
    expect(sanitizeSpeakingContext({ goal: 'hack', stakes: 'x', audience: '' })).toBeNull();
    expect(sanitizeSpeakingContext({ audience: 'a'.repeat(500) }).audience).toHaveLength(120);
    expect(sanitizeSpeakingContext(null)).toBeNull();
  });

  it('puts the stated context in the field notes prompt, with the rule never to contradict it', () => {
    const prompt = buildFieldNotesPrompt(lines, { prompt: 'Pitch it.', speakingContext: { audience: 'Investors', goal: 'persuade', stakes: 'critical' } });
    expect(prompt).toContain("The speaker's stated context (audience: Investors; goal: to persuade; stakes: critical (a big moment))");
    expect(FIELD_NOTES_SYSTEM).toContain(CONTEXT_RULE);
    expect(CONTEXT_RULE).toMatch(/never suggest smiling more/);
  });

  it('leaves the context out when none was given', () => {
    expect(buildFieldNotesPrompt(lines, {})).not.toContain('stated context');
    expect(describeSpeakingContext({})).toBeNull();
  });

  it('gives the tightened answer the same context and rule', () => {
    expect(buildTightenPrompt(lines, { speakingContext: { goal: 'get_hired' } })).toContain('goal: to get hired');
    expect(TIGHTEN_SYSTEM).toContain(CONTEXT_RULE);
  });
});

describe('skill memory and personal best in the prompt', () => {
  it('lists mastered skills, the personal best and confidence mode', () => {
    const prompt = buildFieldNotesPrompt(lines, {
      masteredSkills: ['fillers_per_min', 'nonsense'],
      personalBest: { scope: 'situation', fillersPerMin: 1.24, timeInZonePct: 70, sessionId: 'x' },
      confidenceMode: true,
    });
    expect(prompt).toContain("Mastered skills (never the one fix's targetMetric): fillers_per_min");
    expect(prompt).not.toContain('nonsense');
    expect(prompt).toContain('personal best on this situation: {"fillersPerMin":1.2,"timeInZonePct":70}');
    expect(prompt).toContain('Confidence mode is on');
    expect(FIELD_NOTES_SYSTEM).toMatch(/never push them toward a single 'correct' voice/);
  });
});
