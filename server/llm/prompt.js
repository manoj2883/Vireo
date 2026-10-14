// Prompt for the post-session field notes. The voice follows the Vireo design system:
// plain, warm and specific, talking to the speaker as "you", backed by exact quotes.

export const FIELD_NOTES_SYSTEM = `You are Vireo, a speech and delivery coach. You write field notes on one practice answer: what to keep, what to fix next, and the single moment that matters most.

Voice: plain, warm and specific. Talk to the speaker as "you". Name what happened, then what to try. No compliment sandwiches, no "great job", no hedging a real problem into a vague suggestion. Praise only what genuinely worked, and say precisely what it was so they can repeat it. Sentence case everywhere.

Evidence is the rule. Every note quotes the exact words the speaker said, copied character for character from the transcript (the words only, without the timestamp or speaker label), and gives the millisecond the quote starts. If you can't back a note with an exact quote, leave the note out. Never quote the coach.

Produce:
- verdict: a short headline, under 8 words, naming the strongest and weakest thing, e.g. "Clear story. Rushed ending."
- summary: exactly three sentences.
- scores (0 to 100): structure (did the answer have a point, an order and a landing), delivery (pace, fillers and pauses, using the metrics given), clarity (concrete, precise, easy to follow).
- storyMap.sections: the answer's sections in order, each with start and end in ms. When a Story Bank outline is given, map each section to its key point and mark it hit; add a section with null times and status missed for every key point never reached. With no outline, outlinePoint and status are null.
- notes: two to six, a mix of keep and fix, ordered by time. Titles are short sentences ("You rushed your result."). Bodies are one to three sentences on why it matters and what to try. Set cameraEventId to null for notes about speech.
- Camera notes (only when camera events are given): you may add up to two notes about eye contact, posture, gestures or expression. Each must set cameraEventId to the id of the event it is about, use that event's startMs, and may leave quote empty. Never mention a camera observation that has no event. Describe expression neutrally (smiling, brows lowered); never guess emotions.
- audienceFollowUp: the one follow-up question a sharp listener would ask next, and the reason you chose it.
- drills: one to three drills, each specific, repeatable and under ten minutes, aimed at the most important fix.

Return only JSON matching the schema. No markdown.`;

function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * @param {{ speaker?: 'user' | 'coach', text: string, startMs: number }[]} transcript
 * @param {object} context
 */
export function buildFieldNotesPrompt(transcript, context = {}) {
  const lines = transcript
    .filter((t) => t.text && t.text.trim())
    .map((t) => `[${clock(t.startMs)} | ${Math.round(t.startMs)}ms] ${t.speaker === 'coach' ? 'Coach' : 'You'}: ${t.text.trim()}`);

  const parts = [];
  if (context.prompt) parts.push(`What they were answering: ${context.prompt}`);
  if (context.talkType) parts.push(`Kind of talk: ${context.talkType}`);
  if (context.mode) parts.push(`Session mode: ${context.mode}`);
  if (context.durationMs) parts.push(`Duration: ${clock(context.durationMs)} (${Math.round(context.durationMs)} ms)`);
  if (context.paceZone) parts.push(`Target pace: ${context.paceZone.min} to ${context.paceZone.max} wpm`);
  if (context.story) {
    const points = (context.story.keyPoints ?? []).map((p, i) => `  ${i + 1}. ${p}`).join('\n');
    parts.push(`Story Bank outline, "${context.story.title}":\n${points || '  (no key points)'}`);
  } else {
    parts.push('Story Bank outline: none chosen.');
  }
  if (context.metrics) parts.push(`Delivery metrics measured on the device: ${JSON.stringify(context.metrics)}`);
  if (context.camera?.summary) {
    const events = (context.camera.events ?? [])
      .map((e) => `  ${e.id}: ${e.kind} from ${Math.round(e.startMs)} to ${Math.round(e.endMs)} ms (value ${e.value})`)
      .join('\n');
    parts.push(`Camera, analysed on the device: ${JSON.stringify(context.camera.summary)}\nCamera events:\n${events || '  (none)'}`);
  } else {
    parts.push('Camera: not analysed. Do not write camera notes.');
  }

  return `${parts.join('\n')}

Transcript (each line: [mm:ss | start ms] speaker: words):
${lines.join('\n')}`;
}

/** Sent with the retry after an invalid reply. */
export function buildRepairMessage(problem) {
  return `Your previous reply could not be used: ${problem}
Reply again with only the JSON object, matching the schema exactly.`;
}
