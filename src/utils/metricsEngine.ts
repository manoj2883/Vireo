/**
 * Pure Client-Side Delivery & Metrics Engine
 * Computes WPM over rolling 15-second window & Filler density over 30 seconds
 */

/**
 * Default target WPM band. Must be calibrated against Mano's personal baseline
 * once initial session history exists.
 */
export const TARGET_WPM_BAND = {
  MIN: 120,
  MAX: 160,
};

export const FILLER_WORDS = [
  'um',
  'uh',
  'like',
  'you know',
  'basically',
  'actually',
  'so yeah',
  'i mean',
  'right',
  'sort of',
];

export interface WordTimestamp {
  word: string;
  timestampSec: number;
}

export interface MetricSnapshot {
  wpm15s: number;
  fillerCount30s: number;
  fillerDensity30s: number; // Fillers per 100 words in 30s
  isWpmOutOfRange: boolean;
  isFillerThresholdExceeded: boolean; // Threshold: >= 5 fillers per 30s window
  detectedFillers: { word: string; timestampSec: number }[];
}

export class MetricsEngine {
  private wordLog: WordTimestamp[] = [];
  private fillerLog: { word: string; timestampSec: number }[] = [];

  public addText(text: string, timestampSec: number = Date.now() / 1000): void {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s']/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0);

    for (const w of words) {
      this.wordLog.push({ word: w, timestampSec });
    }

    const cleanLowerText = text.toLowerCase();
    for (const filler of FILLER_WORDS) {
      const regex = new RegExp(`\\b${filler.replace('?', '\\?')}\\b`, 'gi');
      const matches = cleanLowerText.match(regex);
      if (matches) {
        for (let i = 0; i < matches.length; i++) {
          this.fillerLog.push({ word: filler, timestampSec });
        }
      }
    }
  }

  public getSnapshot(nowSec: number = Date.now() / 1000): MetricSnapshot {
    // 15-second rolling WPM window
    const window15sWords = this.wordLog.filter((w) => w.timestampSec >= nowSec - 15);
    const wpm15s = Math.round((window15sWords.length / 15) * 60);

    // 30-second rolling Filler window
    const window30sWords = this.wordLog.filter((w) => w.timestampSec >= nowSec - 30);
    const window30sFillers = this.fillerLog.filter((f) => f.timestampSec >= nowSec - 30);

    const fillerCount30s = window30sFillers.length;
    const fillerDensity30s = window30sWords.length > 0
      ? Number(((fillerCount30s / window30sWords.length) * 100).toFixed(1))
      : 0;

    const isWpmOutOfRange = wpm15s > 0 && (wpm15s < TARGET_WPM_BAND.MIN || wpm15s > TARGET_WPM_BAND.MAX);
    // Fix #11: Filler threshold is >= 5 per 30s window (interim calibration)
    const isFillerThresholdExceeded = fillerCount30s >= 5;

    return {
      wpm15s,
      fillerCount30s,
      fillerDensity30s,
      isWpmOutOfRange,
      isFillerThresholdExceeded,
      detectedFillers: window30sFillers,
    };
  }

  public reset(): void {
    this.wordLog = [];
    this.fillerLog = [];
  }
}
