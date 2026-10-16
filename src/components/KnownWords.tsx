import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MAX_CUSTOM_TERMS, parseCustomTerms } from '@/live/keyterms';
import { getCustomTerms, saveCustomTerms } from '@/storage/localDb';

/**
 * "Words Vireo should know": the user's name, company and technical terms, sent to the transcriber
 * as keyterms ahead of the built-in ones, so names the transcriber doesn’t know are spelled right.
 */
export function KnownWords() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | { error: string }>('idle');
  const inputId = useId();
  const helpId = useId();

  useEffect(() => {
    getCustomTerms()
      .then((terms) => {
        setSaved(terms);
        setText(terms.join(', '));
      })
      .catch(() => setSaved([]));
  }, []);

  const terms = parseCustomTerms(text);
  const tooMany = text.split(/[,\n]/).filter((t) => t.trim()).length > MAX_CUSTOM_TERMS;

  async function save() {
    try {
      await saveCustomTerms(terms);
      setSaved(terms);
      setText(terms.join(', '));
      setStatus('saved');
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section aria-labelledby="words-h" className="flex flex-col gap-4 border-t border-line pt-10">
      <h2 id="words-h" className="m-0 text-heading">
        Words Vireo should know
      </h2>
      <label htmlFor={inputId} className="m-0 max-w-[720px] text-body text-ink-muted">
        Your name, your company and the technical terms you use, separated by commas. Vireo asks the transcriber to listen for them in every session.
      </label>
      <input
        id={inputId}
        type="text"
        aria-describedby={helpId}
        className="min-h-12 w-full max-w-[720px] rounded-md border border-line bg-surface-100 px-4 text-body text-foreground"
        placeholder="Jordan Lee, Acme Robotics, LangGraph"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus('idle');
        }}
      />
      <p id={helpId} className="m-0 text-small text-ink-muted">
        {tooMany ? `Only the first ${MAX_CUSTOM_TERMS} will be kept.` : `Up to ${MAX_CUSTOM_TERMS} terms.`} Stored on this device; sent to Deepgram with each session’s audio. Delete all data removes them.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={save} disabled={saved === null || terms.join('\n') === (saved ?? []).join('\n')}>
          Save words
        </Button>
        {status === 'saved' && (
          <p role="status" className="m-0 text-small text-ink-muted">
            Saved {terms.length} {terms.length === 1 ? 'word' : 'words'}.
          </p>
        )}
        {typeof status === 'object' && (
          <p role="alert" className="m-0 text-small text-amber">
            Couldn’t save: {status.error}
          </p>
        )}
      </div>
    </section>
  );
}
