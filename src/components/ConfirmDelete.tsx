import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface ConfirmDeleteProps {
  /** The first button's text, e.g. "Delete session". */
  label: string;
  /** Says what will go, e.g. "This deletes the transcript and notes from this device." */
  warning: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}

/**
 * A two-step delete in place of a browser dialog. The only place the alert colour appears
 * besides the recording dot.
 */
export function ConfirmDelete({ label, warning, confirmLabel, onConfirm }: ConfirmDeleteProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const warningId = useId();

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <Button variant="ghost" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-describedby={warningId} className="flex flex-wrap items-center gap-3">
      <span id={warningId} className="text-small text-ink-muted">
        {warning} This can’t be undone.
      </span>
      <Button ref={keepRef} variant="outline" size="sm" className="min-h-11" onClick={() => setAsking(false)} disabled={busy}>
        Keep it
      </Button>
      <Button
        variant="destructive"
        size="sm"
        className="min-h-11"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
