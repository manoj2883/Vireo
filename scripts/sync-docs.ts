/**
 * Regenerates the docs that share a source file with the app, so they can't drift:
 * docs/scoring.md (from src/lib/scoreExplanations.ts). A test fails when they're out of date.
 * Usage: npm run docs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generatedDocs } from '../src/lib/generatedDocs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [file, render] of Object.entries(generatedDocs)) {
  const full = path.join(root, file);
  const before = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  const after = render(before);
  if (after !== before) {
    fs.writeFileSync(full, after);
    console.log(`Updated ${file}`);
  }
}
console.log('Docs are in sync.');
