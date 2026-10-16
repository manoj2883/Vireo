/**
 * Evidence check: every field note must quote words the speaker actually said.
 * Quotes are matched against the speaker's transcript after normalising whitespace and
 * punctuation only, so a reworded or invented quote never reaches the screen.
 */

/** Punctuation becomes a space and runs of whitespace collapse. Case is kept. */
export function normalizeForQuote(text) {
  return String(text ?? '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a searchable transcript: the speaker's lines joined into one normalised string,
 * with the character offset where each line starts.
 * @param {{ speaker?: string, text: string, startMs: number }[]} lines
 */
export function indexTranscript(lines) {
  const spoken = lines.filter((l) => l.speaker !== 'coach');
  let text = '';
  const offsets = [];
  for (const line of spoken) {
    const norm = normalizeForQuote(line.text);
    if (!norm) continue;
    if (text) text += ' ';
    offsets.push({ at: text.length, startMs: line.startMs });
    text += norm;
  }
  return { text, offsets };
}

/** Whole-word match: the quote must not start or end in the middle of a word. */
function findWholeWords(haystack, needle) {
  let from = 0;
  while (from <= haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return -1;
    const before = i === 0 || haystack[i - 1] === ' ';
    const end = i + needle.length;
    const after = end === haystack.length || haystack[end] === ' ';
    if (before && after) return i;
    from = i + 1;
  }
  return -1;
}

/**
 * A previous-fix verdict needs an exact quote from this transcript as evidence, or it is dropped
 * (the result is then unknown rather than a guess).
 * @template {{ achieved: boolean, evidence: string, startMs: number | null }} F
 * @param {F | null | undefined} previousFix
 * @param {{ speaker?: string, text: string, startMs: number }[]} lines
 * @returns {F | null}
 */
export function verifyPreviousFix(previousFix, lines) {
  if (!previousFix || !previousFix.evidence) return null;
  const { notes } = verifyNotes([{ quote: previousFix.evidence, startMs: previousFix.startMs ?? 0 }], lines);
  return notes.length ? { ...previousFix, startMs: notes[0].startMs } : null;
}

/**
 * "Say it more naturally" items: each `original` must be words the speaker actually said, like a
 * note's quote, or the item is dropped.
 * @template {{ original: string }} P
 * @param {P[] | null | undefined} items
 * @param {{ speaker?: string, text: string, startMs: number }[]} lines
 * @returns {P[]}
 */
export function verifyPhrasing(items, lines) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => verifyNotes([{ quote: item.original, startMs: 0 }], lines).notes.length > 0);
}

/**
 * Keep only notes backed by evidence. A speech note's quote must be in the transcript; a kept
 * note whose startMs falls outside the line where its quote begins is moved to that line's start.
 * A camera note must reference a real camera event id; it is moved to that event if its time is off.
 *
 * @template {{ quote: string, startMs: number, cameraEventId?: string | null }} N
 * @param {N[]} notes
 * @param {{ speaker?: string, text: string, startMs: number }[]} lines
 * @param {{ id: string, startMs: number, endMs: number }[]} [cameraEvents]
 * @returns {{ notes: N[], dropped: N[] }}
 */
export function verifyNotes(notes, lines, cameraEvents = []) {
  const { text, offsets } = indexTranscript(lines);
  const kept = [];
  const dropped = [];
  for (const note of notes) {
    if (note.cameraEventId) {
      const event = cameraEvents.find((e) => e.id === note.cameraEventId);
      if (!event) {
        dropped.push(note);
        continue;
      }
      const inside = note.startMs >= event.startMs && note.startMs <= event.endMs;
      kept.push({ ...note, startMs: inside ? note.startMs : Math.round(event.startMs) });
      continue;
    }
    const quote = normalizeForQuote(note.quote);
    const at = quote ? findWholeWords(text, quote) : -1;
    if (at === -1) {
      dropped.push(note);
      continue;
    }
    let li = 0;
    while (li + 1 < offsets.length && offsets[li + 1].at <= at) li++;
    const lineStart = offsets[li]?.startMs ?? 0;
    const nextStart = offsets[li + 1]?.startMs ?? Infinity;
    const startMs = note.startMs >= lineStart && note.startMs < nextStart ? note.startMs : lineStart;
    kept.push({ ...note, startMs });
  }
  return { notes: kept, dropped };
}
