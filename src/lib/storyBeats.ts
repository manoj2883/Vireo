/** The five story beats, in story order, with plain labels. */
import type { BeatKind } from '@/types/fieldNotes';

export const BEAT_ORDER: BeatKind[] = ['hook', 'stakes', 'turn', 'payoff', 'landing'];

export const BEAT_LABELS: Record<BeatKind, { label: string; meaning: string }> = {
  hook: { label: 'Hook', meaning: 'The opening that makes a listener want more.' },
  stakes: { label: 'Stakes', meaning: 'What was at risk, or why it mattered.' },
  turn: { label: 'Turn', meaning: 'The moment things changed.' },
  payoff: { label: 'Payoff', meaning: 'The result.' },
  landing: { label: 'Landing line', meaning: 'The line that sums it up at the end.' },
};
