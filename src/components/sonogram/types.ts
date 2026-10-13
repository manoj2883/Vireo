export type WordKind = 'speech' | 'filler' | 'rushed';

export interface WordSegment {
  text: string;
  startMs: number;
  endMs: number;
  kind: WordKind;
  /** Pitch samples in Hz, evenly spaced across the word. Non-positive or non-finite values mean unvoiced. */
  pitch?: number[];
}

export interface PauseSpan {
  startMs: number;
  /** Omit or set to Infinity while the pause is still going. */
  endMs?: number;
}

export type AnnotationTone = 'amber' | 'sky' | 'olive' | 'muted';

/** A field-guide note pinned above a span of the trace, e.g. one the teardown flags. */
export interface SonogramAnnotation {
  startMs: number;
  endMs: number;
  text: string;
  tone?: AnnotationTone;
}

export type SonogramMode = 'static' | 'reveal' | 'scrolling';

/** hero: whole answers with labels and notes. ribbon: the live strip. mini: Home and Story Bank cards. */
export type SonogramVariant = 'hero' | 'ribbon' | 'mini';
