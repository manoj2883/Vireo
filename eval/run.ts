/**
 * Accuracy harness: compares Vireo's on-device metrics against hand-labelled recordings.
 * Usage: npm run eval            (every eval/labels/*.json)
 *        npm run eval -- one.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readWav, synthesise } from './lib/audio';
import { evaluateFile, type FileResult } from './lib/evaluate';
import { combine } from './lib/scoring';
import type { LabelFile } from './lib/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const labelsDir = path.join(here, 'labels');
const only = process.argv.slice(2).filter((a) => a.endsWith('.json'));
const files = (only.length ? only : fs.readdirSync(labelsDir).filter((f) => f.endsWith('.json'))).sort();

if (!files.length) {
  console.log('No label files in eval/labels. See eval/README.md for the format.');
  process.exit(0);
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(7);
const results: { name: string; r: FileResult }[] = [];

for (const file of files) {
  const label = JSON.parse(fs.readFileSync(path.join(labelsDir, path.basename(file)), 'utf8')) as LabelFile;
  const audio = typeof label.audio === 'string' ? readWav(path.join(here, label.audio)) : synthesise(label);
  results.push({ name: path.basename(file, '.json'), r: evaluateFile(label, audio) });
}

const rows = results.map(({ name, r }) => [
  name.padEnd(28).slice(0, 28),
  pct(r.fillers.precision),
  pct(r.fillers.recall),
  `${r.wpm.mae.toFixed(1)}`.padStart(8),
  pct(r.pauses.f1),
  `${r.pauses.truePositives}/${r.pauses.truePositives + r.pauses.falseNegatives}`.padStart(7),
]);

const fillers = combine(results.map((x) => x.r.fillers));
const pauses = combine(results.map((x) => x.r.pauses));
const points = results.reduce((s, x) => s + x.r.wpm.points, 0);
const mae = points ? results.reduce((s, x) => s + x.r.wpm.mae * x.r.wpm.points, 0) / points : 0;

console.log('\nVireo metrics accuracy\n');
console.log(['recording'.padEnd(28), 'filler P', 'filler R', 'WPM MAE', 'pause F1', 'pauses'].join('  '));
for (const r of rows) console.log(r.join('   '));
console.log('-'.repeat(78));
console.log(
  ['all'.padEnd(28), pct(fillers.precision), pct(fillers.recall), `${mae.toFixed(1)}`.padStart(8), pct(pauses.f1), `${pauses.truePositives}/${pauses.truePositives + pauses.falseNegatives}`.padStart(7)].join('   ')
);
console.log(`\nFiller precision ${pct(fillers.precision).trim()}, recall ${pct(fillers.recall).trim()}. WPM mean absolute error ${mae.toFixed(1)} over ${points} seconds. Pause F1 ${pct(pauses.f1).trim()}.\n`);
