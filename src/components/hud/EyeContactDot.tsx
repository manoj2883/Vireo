import { cn } from '@/lib/utils';

/**
 * The one live camera cue: a small dot that stays lit while you look at the camera and dims
 * (and hollows, so it isn't colour alone) after 3 s of looking away.
 */
export function EyeContactDot({ eyeContact, className }: { eyeContact: { looking: boolean; dim: boolean } | null; className?: string }) {
  if (!eyeContact) return null;
  const dim = eyeContact.dim;
  return (
    <div
      role="status"
      aria-label={dim ? 'Eye contact: looking away' : 'Eye contact: on'}
      data-dim={dim || undefined}
      className={cn('flex h-9 items-center gap-2 rounded-pill bg-surface-100/90 px-3 transition-opacity duration-700', dim ? 'opacity-50' : 'opacity-100', className)}
    >
      <span
        aria-hidden="true"
        className={cn('h-3 w-3 rounded-pill transition-all duration-700', dim ? 'bg-transparent shadow-[inset_0_0_0_1.5px_rgb(var(--ink-muted))]' : 'bg-olive')}
      />
      <span className="text-small text-ink-muted" aria-hidden="true">
        Eye contact
      </span>
    </div>
  );
}
