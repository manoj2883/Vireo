import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DATA_FLOWS, NEVER_DOES, STAYS_ON_DEVICE } from '@/data/dataFlows';
import { ACCURACY, ACCURACY_REPORT_URL } from '@/lib/scoreExplanations';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { deleteAllData } from '@/storage/localDb';

const REPO = 'https://github.com/manoj2883/Vireo';

const ACCURACY_ROWS: { key: keyof NonNullable<typeof ACCURACY.metrics>; label: string; wpm?: boolean }[] = [
  { key: 'fillerPrecision', label: 'Filler precision' },
  { key: 'fillerRecall', label: 'Filler recall' },
  { key: 'paceMae', label: 'Pace error (wpm, mean absolute)', wpm: true },
  { key: 'paceWithin10', label: 'Pace within ±10 wpm' },
  { key: 'pauseF1', label: 'Pause F1' },
];

/** Render "**bold**" and "`code`" from the shared data file as real elements. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
        part.startsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith('`') ? (
          <code key={i} className="rounded-sm bg-surface-200 px-1 text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

const H2 = 'm-0 font-display text-[clamp(30px,3.6vw,44px)] font-normal leading-[1.1] tracking-[-0.02em]';

/** Trust (`/trust`): what stays, what leaves, what Vireo never does, how feedback is checked, accuracy. */
export function TrustPage() {
  const [deleted, setDeleted] = useState(false);
  return (
    <div className="flex max-w-[960px] flex-col gap-16">
      <header className="flex flex-col gap-5">
        <p className="m-0 text-label text-ink-muted">Trust</p>
        <h1 className="m-0 font-display text-[clamp(44px,6vw,80px)] font-normal leading-[0.98] tracking-[-0.03em]">What happens to your voice</h1>
        <p className="m-0 max-w-[720px] text-[19px] leading-[30px] text-ink-muted">
          Vireo measures as much as it can on your device and says exactly what it sends where. This page and the README’s Privacy section come from the same file, so they can’t disagree.
        </p>
      </header>

      <section aria-labelledby="stays-h" className="flex flex-col gap-5">
        <h2 id="stays-h" className={H2}>
          Stays on this device
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-3 pl-5 text-body marker:text-olive">
          {STAYS_ON_DEVICE.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="leaves-h" className="flex flex-col gap-5">
        <h2 id="leaves-h" className={H2}>
          Leaves this device
        </h2>
        <ul className="m-0 flex list-none flex-col p-0">
          {DATA_FLOWS.map((f) => (
            <li key={f.id} className="grid gap-2 border-t border-line py-5 sm:grid-cols-[1fr_1fr] sm:gap-8">
              <div className="flex flex-col gap-1">
                <p className="m-0 text-body font-semibold">
                  <Rich text={f.what} />
                </p>
                <p className="m-0 text-small text-ink-muted">{f.when}</p>
              </div>
              <p className="m-0 text-body">
                <Rich text={f.goesTo} />
              </p>
            </li>
          ))}
        </ul>
        <p className="m-0 text-small text-ink-muted">
          Each provider handles what it receives under its own terms. Some free tiers let the provider use submitted content to improve its products.
        </p>
      </section>

      <section aria-labelledby="never-h" className="flex flex-col gap-5">
        <h2 id="never-h" className={H2}>
          Vireo never
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-3 pl-5 text-body marker:text-olive">
          {NEVER_DOES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="checked-h" className="flex flex-col gap-4">
        <h2 id="checked-h" className={H2}>
          How feedback is checked
        </h2>
        <p className="m-0 text-body">
          Field notes come from a language model, so Vireo doesn’t take them on trust. The reply must match a fixed schema. Every quote, story beat, landing line and “say it more naturally” line is matched word for word against your transcript, and every camera note must point at a real camera event. Anything that doesn’t match is dropped before you see it, and the notes page says how many were left out.
        </p>
        <p className="m-0 text-body">
          Pace, pauses and fillers aren’t written by a model at all: they’re measured in your browser. Each score has a “How this was scored” note with its formula, your inputs and its target.
        </p>
      </section>

      <section aria-labelledby="acc-h" className="flex flex-col gap-4">
        <h2 id="acc-h" className={H2}>
          Current accuracy
        </h2>
        {ACCURACY.published && ACCURACY.metrics ? (
          <>
            <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6">
              {ACCURACY_ROWS.map((r) => {
                const m = ACCURACY.metrics?.[r.key];
                return m ? (
                  <div key={r.key} className="border-t border-line pt-3">
                    <dt className="text-label text-ink-muted">{r.label}</dt>
                    <dd className="m-0 font-display text-[36px] leading-tight tabular-nums">{r.wpm ? m.value.toFixed(1) : `${(m.value * 100).toFixed(1)}%`}</dd>
                  </div>
                ) : null;
              })}
            </dl>
            <p className="m-0 text-small text-ink-muted">
              Against {ACCURACY.recordings} hand-labelled recordings.{' '}
              <a href={ACCURACY_REPORT_URL} className="text-olive underline underline-offset-4" target="_blank" rel="noreferrer">
                Full report with 95% intervals
              </a>
            </p>
          </>
        ) : (
          <p className="m-0 text-body">
            Not published yet. Vireo publishes accuracy only once at least {ACCURACY.minRecordings} real recordings have been labelled by hand ({ACCURACY.recordings} so far).{' '}
            <a href={`${REPO}/blob/main/eval/README.md`} className="text-olive underline underline-offset-4" target="_blank" rel="noreferrer">
              How recordings are labelled
            </a>
          </p>
        )}
      </section>

      <section aria-labelledby="delete-h" className="flex flex-col gap-4 border-t border-line pt-10">
        <h2 id="delete-h" className="m-0 text-heading">
          Delete all data
        </h2>
        <p className="m-0 max-w-[720px] text-body text-ink-muted">Removes every session, note, story, saved word and setting from this browser. There’s no copy anywhere else to delete.</p>
        <div className="flex flex-wrap items-center gap-4">
          <ConfirmDelete
            label="Delete all data"
            warning="This deletes every session, note, story and saved word on this device."
            confirmLabel="Delete everything"
            onConfirm={async () => {
              await deleteAllData();
              setDeleted(true);
            }}
          />
          {deleted && (
            <p role="status" className="m-0 text-small text-ink-muted">
              Everything Vireo kept on this device is gone.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="open-h" className="flex flex-col gap-3">
        <h2 id="open-h" className="m-0 text-heading">
          Open source
        </h2>
        <p className="m-0 text-body text-ink-muted">
          Vireo is open source under the{' '}
          <a href={`${REPO}/blob/main/LICENSE`} className="text-olive underline underline-offset-4" target="_blank" rel="noreferrer">
            MIT licence
          </a>
          . You can read every line, or{' '}
          <a href={`${REPO}#local-setup`} className="text-olive underline underline-offset-4" target="_blank" rel="noreferrer">
            run it yourself
          </a>{' '}
          with your own keys. <Link to="/app" className="text-olive underline underline-offset-4">Back to Home</Link>
        </p>
      </section>
    </div>
  );
}
