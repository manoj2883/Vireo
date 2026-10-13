import { Link } from 'react-router-dom';

/** Three stacked harmonic strokes and an apricot note: the sonogram in miniature. */
export function VireoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <path d="M5 24c4-3 7-3 10 0s6 2 9-2" fill="none" stroke="rgb(var(--olive))" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M5 16c4-3 7-3 10 0s6 2 9-2" fill="none" stroke="rgb(var(--olive))" strokeOpacity="0.6" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5 9c4-3 7-3 10 0s6 2 9-2" fill="none" stroke="rgb(var(--olive))" strokeOpacity="0.32" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="28.5" cy="21" r="2.2" fill="rgb(var(--amber))" />
    </svg>
  );
}

export function VireoWordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-sm text-foreground">
      <VireoMark />
      <span className="font-display text-[26px] font-medium">Vireo</span>
    </Link>
  );
}
