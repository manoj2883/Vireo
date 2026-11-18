/**
 * What stays on the device and what leaves it: the one source for the trust page and the README's
 * Privacy section (`npm run docs` regenerates the README table). Anything new that leaves the
 * device must be added here first; a test checks the README matches.
 */

export interface DataFlow {
  id: string;
  what: string;
  when: string;
  goesTo: string;
}

export const STAYS_ON_DEVICE: string[] = [
  'Video is never recorded, stored or uploaded. The camera is analysed in your browser with MediaPipe; only timed events, like “looked away from 0:41 to 0:45”, are kept, on this device.',
  'Pauses, pace, fillers, pitch and loudness are measured in your browser.',
  'Sessions (transcript, sonogram, metrics, field notes), your Story Bank, ghost pace, fix adoption and settings are stored in this browser’s IndexedDB. Nothing is kept on a server.',
  'The share card and PDF report are drawn in your browser. The share card leaves out your words unless you tick “Include my words”.',
];

export const DATA_FLOWS: DataFlow[] = [
  {
    id: 'transcription',
    what: 'Microphone audio (16 kHz), plus keyterms: distinctive words from your question and story, and your “Words Vireo should know”',
    when: 'During a live session, and when you upload a recording (its audio only, taken out of the file on this device)',
    goesTo: '**Deepgram**, directly from your browser, for transcription. The Vireo server only issues the short-lived token that opens the connection. An uploaded video file never leaves this device.',
  },
  {
    id: 'field-notes',
    what: 'Transcript text and timestamps, your prompt, situation, pace zone, on-device metrics, camera events (not images) and the chosen Story Bank outline',
    when: 'When field notes and the tightened answer are written',
    goesTo: 'The Vireo server, which sends it to the provider in `LLM_PROVIDER` (and `LLM_FALLBACKS` if that one is busy): **Google Gemini**, **Anthropic** (Claude), or **OpenRouter** (which forwards it to the provider of the model chosen).',
  },
  {
    id: 'story-interview',
    what: 'Your answers in the Story Bank interview, and the story’s working title',
    when: 'When you use “Build a story with me”, one answer at a time',
    goesTo: 'The Vireo server, which sends them to the same field notes provider. The finished story is saved only on this device.',
  },
  {
    id: 'roleplay',
    what: 'The partner’s questions so far and the transcript of your answers (for questions after a talk, the talk’s transcript too), your prompt and stated context',
    when: 'Each turn of “Practise with a partner” or “Take questions”',
    goesTo: 'The Vireo server, which sends it to the field notes provider for the next question, and sends the question’s text to **Deepgram** to be spoken. If that voice isn’t available, your browser speaks it instead.',
  },
  {
    id: 'limits',
    what: 'An anonymous random cookie and your IP address',
    when: 'When a session starts and when notes are written',
    goesTo: 'The Vireo server, only to apply usage limits. Counters are kept in **Upstash Redis** when it’s configured.',
  },
  {
    id: 'hosting',
    what: 'Ordinary web requests (your IP address, browser and the page asked for)',
    when: 'Whenever you load Vireo',
    goesTo: '**Vercel**, which hosts the public site and keeps standard request logs. A self-hosted copy uses your own server instead.',
  },
  {
    id: 'downloads',
    what: 'Requests for the fonts and the on-device camera models (your IP address and browser; no session data)',
    when: 'When a page loads, and when the camera is first used',
    goesTo: '**Google Fonts** for the typefaces; **Google’s model storage** and **jsDelivr** for the MediaPipe camera models. No frames or audio are sent.',
  },
];

export const NEVER_DOES: string[] = [
  'Record, store or upload your video.',
  'Keep your audio. It streams to Deepgram for transcription and Vireo never saves it.',
  'Keep your sessions, transcripts or notes on a server. There are no accounts and no server database.',
  'Guess or label your emotions. Vireo only reports what it can observe: pace, pauses, fillers, pitch range, loudness, gaze direction, posture and visible expression (such as smiling), never what you felt.',
  'Write your transcript text to its server logs. Only counts and errors are logged.',
  'Show a note it can’t back with your exact words.',
];

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** The README's "Leaves your device" table. */
export function renderDataFlowTable(flows: readonly DataFlow[] = DATA_FLOWS): string {
  return ['| What | When | Goes to |', '| :--- | :--- | :--- |', ...flows.map((f) => `| ${cell(f.what)} | ${cell(f.when)} | ${cell(f.goesTo)} |`)].join('\n');
}

/** The README's generated privacy lists: what stays, what leaves, what Vireo never does. */
export function renderPrivacyMarkdown(): string {
  return [
    '**Stays on your device**',
    '',
    ...STAYS_ON_DEVICE.map((s) => `- ${s}`),
    '',
    '**Leaves your device**',
    '',
    renderDataFlowTable(),
    '',
    '**Vireo never**',
    '',
    ...NEVER_DOES.map((s) => `- ${s}`),
  ].join('\n');
}

export const PRIVACY_START = '<!-- privacy:start -->';
export const PRIVACY_END = '<!-- privacy:end -->';
