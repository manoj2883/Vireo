// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildInterviewPrompt, INTERVIEW_SYSTEM, MAX_SCRIPT_WORDS, sanitizeTurns, validateInterview } from './interview.js';
import { generateInterviewTurn } from './index.js';

const turns = [
  { role: 'coach', text: 'When was it, and where were you?' },
  { role: 'speaker', text: 'It was a Tuesday night in the lab and the demo crashed an hour before the investors arrived.' },
  { role: 'coach', text: 'What did someone say?' },
  { role: 'speaker', text: 'My manager said "we cancel or we fix it now". We fixed it with ten minutes to spare. I learned to rehearse the failure, not the success. The red error screen is what I still see. Rehearse the failure.' },
];

const allFilled = {
  hook: 'the demo crashed an hour before the investors arrived',
  stakes: 'we cancel or we fix it now',
  turn: 'We fixed it with ten minutes to spare',
  payoff: 'We fixed it with ten minutes to spare',
  image: 'The red error screen',
  lesson: 'I learned to rehearse the failure, not the success',
  landing: 'Rehearse the failure.',
};

const reply = (o) => JSON.stringify({ filled: { hook: null, stakes: null, turn: null, payoff: null, image: null, lesson: null, landing: null }, done: false, question: null, story: null, ...o });

describe('story interviewer', () => {
  it('asks one question at a time and pushes for the scene', () => {
    expect(INTERVIEW_SYSTEM).toMatch(/one question at a time, never two/i);
    expect(INTERVIEW_SYSTEM).toMatch(/the exact words someone said/);
    expect(buildInterviewPrompt({ title: 'The crash', turns })).toContain('Speaker: It was a Tuesday night');
  });

  it('empties slots that do not quote the speaker, and keeps asking', () => {
    const r = validateInterview(reply({ filled: { ...allFilled, payoff: 'We won the contract' , landing: null }, question: 'How did it end?' }), turns);
    expect(r.data).toMatchObject({ done: false, question: 'How did it end?', story: null, droppedQuotes: 1 });
    expect(r.data.filled.payoff).toBeNull();
    expect(r.data.filled.hook).toBe(allFilled.hook);
  });

  it('asks for a repair when slots are empty and no question was asked', () => {
    expect(validateInterview(reply({}), turns).problem).toMatch(/still empty.*ask one question about hook/);
  });

  it('finishes with a script built only from the speaker’s words', () => {
    const story = { title: 'The crash', script: 'The demo crashed an hour before the investors arrived. We fixed it with ten minutes to spare. Rehearse the failure.', keyPoints: ['The crash', 'The fix', 'The lesson'] };
    const r = validateInterview(reply({ filled: allFilled, done: true, story }), turns);
    expect(r.data).toMatchObject({ done: true, question: null, story });
  });

  it('rejects a script with invented words or one that runs long', () => {
    const invented = { title: 't', script: 'Our heroic team saved the billion dollar launch.', keyPoints: ['a', 'b'] };
    expect(validateInterview(reply({ filled: allFilled, done: true, story: invented }), turns).problem).toMatch(/never said/);
    const long = { title: 't', script: Array.from({ length: MAX_SCRIPT_WORDS + 1 }, () => 'failure').join(' '), keyPoints: ['a', 'b'] };
    expect(validateInterview(reply({ filled: allFilled, done: true, story: long }), turns).problem).toMatch(/keep it to 90/);
  });

  it('bounds and cleans turns', () => {
    expect(sanitizeTurns([{ role: 'x', text: ' hi ' }, { text: 3 }, null])).toEqual([{ role: 'speaker', text: 'hi' }]);
    expect(sanitizeTurns(Array.from({ length: 50 }, () => ({ role: 'speaker', text: 'a' })))).toHaveLength(30);
  });

  it('runs through the provider chain with one repair round', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: reply({}) })
      .mockResolvedValueOnce({ text: reply({ question: 'What happened next?' }) });
    const r = await generateInterviewTurn({ turns }, { providers: [{ name: 'fake', model: 'f1', complete }], log: () => {} });
    expect(r).toMatchObject({ question: 'What happened next?', done: false, provider: 'fake' });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
