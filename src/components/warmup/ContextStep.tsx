import { useId } from 'react';
import { cn } from '@/lib/utils';
import { AUDIENCE_SUGGESTIONS, cleanContext, GOALS, MAX_AUDIENCE_CHARS, STAKES, type SpeakingContext } from '@/session/speakingContext';

/**
 * The optional "who's it for" step: audience, goal and stakes. Everything is optional; field
 * notes, the tightened answer and roleplay all receive whatever is set.
 */
export function ContextStep({ value, onChange }: { value: SpeakingContext | undefined; onChange: (next: SpeakingContext | undefined) => void }) {
  const ids = { audience: useId(), list: useId(), goal: useId(), stakes: useId(), hint: useId() };
  const v = value ?? {};
  // Kept as typed while editing; the warm-up cleans it when the session starts.
  const update = (patch: Partial<SpeakingContext>) => onChange({ ...v, ...patch });
  const set = Boolean(cleanContext(value));

  return (
    <details className="group rounded-md bg-surface-100 p-[18px]" open={set || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-sm">
        <span className="flex flex-col">
          <span className="text-lg font-semibold">Who’s it for?</span>
          <span id={ids.hint} className="text-[15px] text-ink-muted">
            Optional. Your notes will fit the audience, goal and stakes you give.
          </span>
        </span>
        <span className="text-label text-ink-muted group-open:hidden">{set ? 'Edit' : 'Add'}</span>
        <span className="hidden text-label text-ink-muted group-open:inline">Hide</span>
      </summary>

      <div className="mt-4 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.audience} className="text-[15px] text-ink-muted">
            Audience
          </label>
          <input
            id={ids.audience}
            list={ids.list}
            maxLength={MAX_AUDIENCE_CHARS}
            value={v.audience ?? ''}
            onChange={(e) => update({ audience: e.target.value })}
            placeholder="A hiring manager at a hospital"
            className="min-h-11 rounded-md border-0 bg-surface-000 px-4 text-[17px] text-foreground placeholder:text-ink-muted/70"
          />
          <datalist id={ids.list}>
            {AUDIENCE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[15px] text-ink-muted">Goal</legend>
          <div className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <Pill key={g.id} name={ids.goal} checked={v.goal === g.id} onChange={() => update({ goal: g.id })} label={g.label} />
            ))}
          </div>
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[15px] text-ink-muted">Stakes</legend>
          <div className="flex flex-wrap gap-2">
            {STAKES.map((s) => (
              <Pill key={s.id} name={ids.stakes} checked={v.stakes === s.id} onChange={() => update({ stakes: s.id })} label={s.label} />
            ))}
          </div>
          {v.stakes && <p className="m-0 text-[14px] text-ink-muted">{STAKES.find((s) => s.id === v.stakes)?.hint}</p>}
        </fieldset>

        {set && (
          <div>
            <button type="button" onClick={() => onChange(undefined)} className="min-h-11 rounded-sm text-label text-olive underline-offset-4 hover:underline">
              Clear
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

function Pill({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center rounded-pill px-5 text-[16px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-olive',
        checked ? 'bg-olive font-semibold text-olive-foreground' : 'bg-surface-000 text-ink-muted hover:text-ink'
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}
