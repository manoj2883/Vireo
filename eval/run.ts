/**
 * Accuracy harness: compares Vireo's on-device metrics against hand-labelled recordings.
 * Usage: npm run eval                 (every eval/labels/*.json, printed)
 *        npm run eval -- one.json     (just that file)
 *        npm run eval -- --report     (also writes docs/accuracy.md and src/data/accuracy.json)
 *        npm run eval:readme          (fills the README table between the eval markers)
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readWav, synthesise } from './lib/audio';
import { evaluateFile } from './lib/evaluate';
import { combine } from './lib/scoring';
import { buildAccuracyReport, README_END, README_START, renderAccuracyMarkdown, renderReadmeTable, replaceBetween, type RecordingResult } from './lib/report';
import type { LabelFile } from './lib/types';
import { renderScoringMarkdown } from '../src/lib/scoreExplanations';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const labelsDir = path.join(here, 'labels');
const args = process.argv.slice(2);
const writeReport = args.includes('--report');
const writeReadme = args.includes('--readme');
const only = args.filter((a) => a.endsWith('.json'));
const files = (only.length ? only : fs.readdirSync(labelsDir).filter((f) => f.endsWith('.json'))).sort();

const results: RecordingResult[] = [];
for (const file of files) {
  const label = JSON.parse(fs.readFileSync(path.join(labelsDir, path.basename(file)), 'utf8')) as LabelFile;
  const synthetic = typeof label.audio !== 'string';
  const audio = typeof label.audio === 'string' ? readWav(path.join(here, label.audio)) : synthesise(label);
  const r = evaluateFile(label, audio);
  const paceErrors: number[] = [];
  r.series.predicted.forEach((p, i) => {
    const t = r.series.truth[i];
    if (p !== null && t !== null) paceErrors.push(Math.abs(p - t));
  });
  results.push({
    name: path.basename(file, '.json'),
    durationMs: (audio.samples.length / audio.sampleRate) * 1000,
    synthetic,
    fillers: r.fillers,
    pauses: r.pauses,
    paceErrors,
  });
}

if (!results.length) console.log('No label files in eval/labels. See eval/README.md for the format.');

const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(7);
const mae = (errs: number[]) => (errs.length ? errs.reduce((s, e) => s + e, 0) / errs.length : 0);
if (results.length) {
  console.log('\nVireo metrics accuracy\n');
  console.log(['recording'.padEnd(28), 'filler P', 'filler R', 'WPM MAE', 'pause F1', 'pauses'].join('  '));
  for (const r of results) {
    console.log(
      [
        `${r.name}${r.synthetic ? ' (synthetic)' : ''}`.padEnd(28).slice(0, 28),
        pct(r.fillers.precision),
        pct(r.fillers.recall),
        mae(r.paceErrors).toFixed(1).padStart(8),
        pct(r.pauses.f1),
        `${r.pauses.truePositives}/${r.pauses.truePositives + r.pauses.falseNegatives}`.padStart(7),
      ].join('   ')
    );
  }
  const f = combine(results.map((x) => x.fillers));
  const p = combine(results.map((x) => x.pauses));
  const errs = results.flatMap((x) => x.paceErrors);
  console.log('-'.repeat(78));
  console.log(`\nAll files: filler precision ${pct(f.precision).trim()}, recall ${pct(f.recall).trim()}. WPM mean absolute error ${mae(errs).toFixed(1)} over ${errs.length} seconds. Pause F1 ${pct(p.f1).trim()}.\n`);
}

if (writeReport || writeReadme) {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch {
    // Not a git checkout: the report says "unknown".
  }
  const report = buildAccuracyReport(results, { generatedAt: new Date().toISOString(), commit });
  if (writeReport) {
    fs.writeFileSync(path.join(root, 'docs/accuracy.md'), renderAccuracyMarkdown(report));
    fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/data/accuracy.json'), `${JSON.stringify(report, null, 2)}\n`);
    // docs/scoring.md quotes the accuracy, so it's regenerated with it.
    fs.writeFileSync(path.join(root, 'docs/scoring.md'), renderScoringMarkdown(report));
    console.log(`Wrote docs/accuracy.md, docs/scoring.md and src/data/accuracy.json (${report.published ? 'published' : `not published: fewer than ${report.minRecordings} real recordings`}).`);
  }
  if (writeReadme) {
    const readmePath = path.join(root, 'README.md');
    fs.writeFileSync(readmePath, replaceBetween(fs.readFileSync(readmePath, 'utf8'), README_START, README_END, renderReadmeTable(report)));
    console.log('Filled the README accuracy table.');
  }
}
