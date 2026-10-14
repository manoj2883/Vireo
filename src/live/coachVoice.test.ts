import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachVoice } from './coachVoice';

/** A stand-in for HTMLAudioElement that can be told whether its file loaded. */
class FakeAudio {
  static loads = true;
  static instances: FakeAudio[] = [];
  paused = true;
  ended = false;
  currentTime = 0;
  preload = '';
  private listeners: Record<string, (() => void)[]> = {};
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  load() {
    for (const fn of this.listeners[FakeAudio.loads ? 'canplaythrough' : 'error'] ?? []) fn();
  }
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ lang: 'en-GB' }] };

beforeEach(() => {
  FakeAudio.instances = [];
  FakeAudio.loads = true;
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    lang = '';
    voice: unknown = null;
    onend: (() => void) | null = null;
    constructor(public text: string) {}
  });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  synth.speak.mockClear();
  synth.cancel.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe('CoachVoice', () => {
  it('plays the pre-recorded clip for the nudge', () => {
    const voice = new CoachVoice();
    voice.play('fast');
    const clip = FakeAudio.instances.find((a) => a.src === '/coach/slow-down.mp3')!;
    expect(clip.play).toHaveBeenCalled();
    expect(voice.isPlaying()).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('stops the clip at once', () => {
    const voice = new CoachVoice();
    voice.play('slow');
    voice.stop();
    const clip = FakeAudio.instances.find((a) => a.src === '/coach/pick-it-up.mp3')!;
    expect(clip.pause).toHaveBeenCalled();
    expect(voice.isPlaying()).toBe(false);
  });

  it('falls back to the browser’s English voice when the clip is missing', () => {
    FakeAudio.loads = false;
    const voice = new CoachVoice();
    voice.play('fast');
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = synth.speak.mock.calls[0][0];
    expect(utterance).toMatchObject({ text: 'Slow down. Let the result land.', lang: 'en-US' });
    expect(voice.isPlaying()).toBe(true);
    voice.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(voice.isPlaying()).toBe(false);
  });
});
