import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SITUATIONS, situationById, type SituationId } from '@/session/situations';
import { TALK_TYPES } from '@/live/metrics/pace';
import { summariseTake } from '@/live/metrics/ghost';
import { buildKeyterms, mergeKeyterms } from '@/live/keyterms';
import { analyseRecording, decodeToMono16k, encodeWav16, MAX_RECORDING_MS, transcribeRecording, UPLOAD_SAMPLE_RATE } from '@/upload/recording';
import { getCustomTerms, newId, saveSession, type StoredSession } from '@/storage/localDb';
import type { SessionConfig } from '@/session/config';

type Step = 'idle' | 'decoding' | 'transcribing' | 'analysing' | 'saving';

const STEP_TEXT: Record<Exclude<Step, 'idle'>, string> = {
  decoding: 'Taking the sound out of your file, on this device',
  transcribing: 'Transcribing with Deepgram',
  analysing: 'Measuring pace, pauses and fillers, on this device',
  saving: 'Saving and opening your field notes',
};

/** Upload (`/upload`): an audio or video file of a real talk, analysed like a live session. */
export function UploadPage() {
  const navigate = useNavigate();
  const ids = { file: useId(), situation: useId(), prompt: useId(), note: useId() };
  const [file, setFile] = useState<File | null>(null);
  const [situationId, setSituationId] = useState<SituationId | ''>('presentation');
  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const situation = situationById(situationId || undefined);
  const busy = step !== 'idle';

  async function run() {
    if (!file || busy) return;
    setError(null);
    try {
      setStep('decoding');
      const samples = await decodeToMono16k(file);
      setStep('transcribing');
      const talkType = situation?.talkType ?? 'free';
      const title = prompt.trim() || file.name.replace(/\.[^.]+$/, '');
      const keyterms = mergeKeyterms(await getCustomTerms().catch(() => []), buildKeyterms({ prompt: title }));
      const words = await transcribeRecording(encodeWav16(samples, UPLOAD_SAMPLE_RATE), keyterms);
      if (!words.length) throw new Error('Deepgram didn’t hear any words in that recording.');
      setStep('analysing');
      const a = analyseRecording(samples, UPLOAD_SAMPLE_RATE, words, talkType);
      setStep('saving');
      const id = newId('sess');
      const config: SessionConfig = { prompt: title, situationId: situation?.id, talkType, mode: 'watch', audience: false, hideFace: true };
      const take = summariseTake(title, id, a.trace, TALK_TYPES[talkType].zone, a.metrics.fillerCount, a.durationMs);
      const session: StoredSession = {
        id,
        createdAt: new Date().toISOString(),
        config,
        segments: a.segments,
        pauses: a.pauses,
        transcript: a.transcript,
        metrics: a.metrics,
        take: { avgWpm: take.avgWpm, inZoneRatio: take.inZoneRatio, fillersPerMin: take.fillersPerMin },
        newBest: false,
        notesStatus: 'pending',
        camera: null,
        source: 'recording',
      };
      await saveSession(session);
      navigate(`/notes/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('idle');
    }
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-10">
      <Link to="/app" className="-mt-4 inline-flex h-11 items-center gap-2 self-start rounded-sm text-label text-ink-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Home
      </Link>
      <header className="flex flex-col gap-4">
        <h1 className="m-0 font-display text-[clamp(44px,6vw,80px)] font-normal leading-[0.98] tracking-[-0.03em]">Upload a real talk</h1>
        <p className="m-0 text-[19px] leading-[30px] text-ink-muted">
          A recording of a talk you’ve given, up to {MAX_RECORDING_MS / 60_000} minutes. Vireo draws it and writes field notes, just like a practice session.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.file} className="text-lg font-semibold">
            Audio or video file
          </label>
          <input
            id={ids.file}
            type="file"
            accept="audio/*,video/*"
            aria-describedby={ids.note}
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="min-h-11 text-[16px] file:mr-4 file:min-h-11 file:rounded-pill file:border-0 file:bg-surface-100 file:px-5 file:font-semibold file:text-ink"
          />
          <p id={ids.note} className="m-0 text-small text-ink-muted">
            Video stays on this device: your browser takes out the sound and only that audio (mono, 16 kHz) goes to Deepgram to be transcribed. The file itself is never uploaded or stored.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={ids.situation} className="text-[15px] text-ink-muted">
            What kind of talk was it?
          </label>
          <select id={ids.situation} value={situationId} disabled={busy} onChange={(e) => setSituationId(e.target.value as SituationId | '')} className="min-h-11 max-w-[420px] rounded-md border-0 bg-surface-100 px-4 text-[17px]">
            {SITUATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="">Something else</option>
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={ids.prompt} className="text-[15px] text-ink-muted">
            What was it about? (optional)
          </label>
          <input id={ids.prompt} value={prompt} disabled={busy} maxLength={300} onChange={(e) => setPrompt(e.target.value)} placeholder="My thesis defence opening" className="min-h-11 rounded-md border-0 bg-surface-100 px-4 text-[17px]" />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={run} disabled={!file || busy}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Analyse this recording
          </Button>
          {busy && (
            <p role="status" className="m-0 text-small text-ink-muted">
              {STEP_TEXT[step as Exclude<Step, 'idle'>]}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="m-0 text-body text-amber">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
