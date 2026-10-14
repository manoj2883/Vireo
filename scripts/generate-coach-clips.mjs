/**
 * Generate the coach's voice clips once, with Deepgram text-to-speech (Aura-2).
 *
 *   npm run coach:clips                 # uses DEEPGRAM_API_KEY from .env
 *   npm run coach:clips -- --voice aura-2-andromeda-en
 *
 * Writes public/coach/slow-down.mp3 and public/coach/pick-it-up.mp3. During a session these play
 * instantly; no text-to-speech or language model is called while you speak.
 * Docs: https://developers.deepgram.com/reference/text-to-speech/speak-request
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The lines must match SPOKEN_NUDGES in src/live/metrics/nudges.ts.
const CLIPS = {
  'slow-down.mp3': 'Slow down. Let the result land.',
  'pick-it-up.mp3': 'Pick it up a little.',
};

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
      .filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')])
  );
}

const args = process.argv.slice(2);
const voice = args.includes('--voice') ? args[args.indexOf('--voice') + 1] : 'aura-2-thalia-en';
const key = process.env.DEEPGRAM_API_KEY || readEnv(path.join(root, '.env')).DEEPGRAM_API_KEY;
if (!key) {
  console.error('DEEPGRAM_API_KEY is not set (in the environment or .env).');
  process.exit(1);
}

const outDir = path.join(root, 'public', 'coach');
fs.mkdirSync(outDir, { recursive: true });

for (const [file, text] of Object.entries(CLIPS)) {
  const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`Deepgram TTS failed for "${text}": HTTP ${res.status} ${body.slice(0, 200)}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(outDir, file), bytes);
  console.log(`Wrote public/coach/${file} (${(bytes.length / 1024).toFixed(1)} KB): "${text}"`);
}
