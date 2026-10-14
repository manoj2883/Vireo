/**
 * Word-level changes between what was said and the tightened script, for the "show changes" view.
 * Uses the longest common subsequence of normalised words, so reordering shows as a removal plus
 * an addition. Pause marks ("/") in the script come through as their own tokens.
 */

export type DiffOp = 'keep' | 'removed' | 'added' | 'pause';

export interface DiffToken {
  text: string;
  op: DiffOp;
}

const norm = (w: string) => w.toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}']/gu, '');

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function wordDiff(original: string, script: string): DiffToken[] {
  const a = words(original);
  const bAll = script.split(/(\s\/\s|\s\/$|^\/\s)/).flatMap((part) => (part.trim() === '/' ? ['/'] : words(part)));
  const b = bAll.filter((w) => w !== '/');
  const na = a.map(norm);
  const nb = b.map(norm);

  // LCS table.
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = na[i] && na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  let k = 0; // position in bAll, to put pause marks back
  const flushPauses = () => {
    while (k < bAll.length && bAll[k] === '/') {
      out.push({ text: '/', op: 'pause' });
      k++;
    }
  };
  flushPauses();
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && na[i] && na[i] === nb[j]) {
      out.push({ text: b[j], op: 'keep' });
      i++;
      j++;
      k++;
      flushPauses();
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ text: b[j], op: 'added' });
      j++;
      k++;
      flushPauses();
    } else {
      out.push({ text: a[i], op: 'removed' });
      i++;
    }
  }
  return out;
}
