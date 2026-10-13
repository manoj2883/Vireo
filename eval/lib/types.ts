/** One hand-labelled recording. All times are milliseconds from the start of the audio. */
export interface LabelFile {
  /** Path to a 16-bit PCM WAV relative to eval/, or { synthetic: true } to synthesise audio from the words. */
  audio: string | { synthetic: true };
  /** Every spoken word with its start and end, fillers included. */
  words: LabelledSpan[];
  /** Filler positions (a phrase like "you know" is one span). */
  fillers: LabelledSpan[];
  /** Silences you count as pauses (over 300 ms, after speech has started). */
  pauses: { startMs: number; endMs: number }[];
  /**
   * Optional: what the live transcriber returned and when, to replay real transcription
   * timing. Without it, words arrive in chunks of four, 500 ms after the chunk's last word.
   */
  asr?: { atMs: number; text: string }[];
  notes?: string;
}

export interface LabelledSpan {
  text: string;
  startMs: number;
  endMs: number;
}

export interface Interval {
  startMs: number;
  endMs: number;
}
