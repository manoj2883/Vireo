import { LOCAL_SETUP_URL } from '@/lib/health';

/** Shown when the server has no transcription or field notes key, so a session can't work. */
export function DemoResting({ className }: { className?: string }) {
  return (
    <p role="status" className={`m-0 rounded-md bg-surface-100 px-5 py-4 text-body text-foreground shadow-[inset_0_0_0_1.5px_rgb(var(--amber))] ${className ?? ''}`}>
      The public demo is resting. Run Vireo locally in a few minutes.{' '}
      <a href={LOCAL_SETUP_URL} className="font-semibold underline underline-offset-4">
        See local setup
      </a>
    </p>
  );
}
