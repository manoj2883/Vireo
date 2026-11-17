/**
 * Docs generated from the same source files the app uses. Each entry turns the file's current
 * text (null if missing) into what it should be. Used by `npm run docs` and the docs test.
 */
import { renderScoringMarkdown } from './scoreExplanations';
import { replaceBetween } from './markers';
import { PRIVACY_END, PRIVACY_START, renderPrivacyMarkdown } from '@/data/dataFlows';

export const generatedDocs: Record<string, (current: string | null) => string> = {
  'docs/scoring.md': () => renderScoringMarkdown(),
  'README.md': (current) => replaceBetween(current ?? '', PRIVACY_START, PRIVACY_END, renderPrivacyMarkdown()),
};
