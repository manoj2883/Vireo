/**
 * Docs generated from the same source files the app uses. Each entry turns the file's current
 * text (null if missing) into what it should be. Used by `npm run docs` and the docs test.
 */
import { renderScoringMarkdown } from './scoreExplanations';

export const generatedDocs: Record<string, (current: string | null) => string> = {
  'docs/scoring.md': () => renderScoringMarkdown(),
};
