/**
 * Turn Audacity label tracks into an eval label file.
 *
 * Usage:
 *   npm run eval:import -- <name> <words.txt> [fillers.txt] [pauses.txt]
 *
 * Each .txt is an Audacity label export: "start<TAB>end<TAB>text" per line, times in seconds.
 * The recording is expected at eval/recordings/<name>.wav.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { LabelFile, LabelledSpan } from './lib/types';

export function parseAudacityLabels(text: string): LabelledSpan[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('\\'))
    .map((line) => {
      const [start, end, ...rest] = line.split('\t');
      return { text: rest.join('\t').trim(), startMs: Math.round(Number(start) * 1000), endMs: Math.round(Number(end) * 1000) };
    })
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs >= s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [name, wordsFile, fillersFile, pausesFile] = process.argv.slice(2);
  if (!name || !wordsFile) {
    console.error('Usage: npm run eval:import -- <name> <words.txt> [fillers.txt] [pauses.txt]');
    process.exit(1);
  }
  const read = (f?: string) => (f ? parseAudacityLabels(fs.readFileSync(f, 'utf8')) : []);
  const label: LabelFile = {
    audio: `recordings/${name}.wav`,
    words: read(wordsFile),
    fillers: read(fillersFile),
    pauses: read(pausesFile).map(({ startMs, endMs }) => ({ startMs, endMs })),
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, 'labels', `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(label, null, 2) + '\n');
  console.log(`Wrote ${out}: ${label.words.length} words, ${label.fillers.length} fillers, ${label.pauses.length} pauses.`);
}
