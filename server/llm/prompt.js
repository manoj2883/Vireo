import { CONTEXT_RULE, describeSpeakingContext } from './context.js';

// Prompt for the post-session field notes. The voice follows the Vireo design system:
// plain, warm and specific, talking to the speaker as "you", backed by exact quotes.

export const FIELD_NOTES_SYSTEM = `You are Vireo, a speech and delivery coach. You write field notes on one practice answer: what to keep, what to fix next, and the single moment that matters most.

Voice: plain, warm and specific. Talk to the speaker as "you". Name what happened, then what to try. No compliment sandwiches, no "great job", no hedging a real problem into a vague suggestion. Praise only what genuinely worked, and say precisely what it was so they can repeat it. Sentence case everywhere.

Evidence is the rule. Every note quotes the exact words the speaker said, copied character for character from the transcript (the words only, without the timestamp or speaker label), and gives the millisecond the quote starts. If you can't back a note with an exact quote, leave the note out. Never quote the coach.

Produce:
- oneFix: the single most important change, written as an instruction for the next take, e.g. instruction "Give your result a full pause before you say it." and a one-sentence why. Everything else is secondary to this. Also name the measure the fix should move, so the next take can show whether it worked: targetMetric is one of fillers_per_min (lower is better), time_in_zone_pct (share of speaking time in the pace zone, higher), time_to_main_point_s (seconds until the first sentence that answers the question, lower), sentence_end_pauses_pct (share of sentence ends followed by a pause of 600 ms or more, higher), eye_contact_pct (higher; only when camera events are given), or not_measurable when none of these would show the change. Set direction to lower or higher to match, or null for not_measurable. When two fixes matter about equally, prefer the one that can be measured.
- mainPointMs: the ms when the speaker first stated their main point (the answer to the question), or null if they never did.
- previousFix: only when a previous fix is given below; otherwise null. achieved is true or false; evidence is an exact quote from this transcript that shows it (or the moment it was missed), with its startMs.
- verdict: a short headline, under 8 words, naming the strongest and weakest thing, e.g. "Clear story. Rushed ending."
- summary: exactly three sentences.
- scores (0 to 100): structure (did the answer have a point, an order and a landing), delivery (pace, fillers and pauses, using the metrics given), clarity (concrete, precise, easy to follow).
- storyMap.sections: the answer's sections in order, each with start and end in ms. When a Story Bank outline is given, map each section to its key point: set outlineIndex to that key point's number as listed (1 for the first) and outlinePoint to its text, and mark it hit when the idea was covered, even if the speaker used different words. Add a section with null times, the key point's outlineIndex and status missed for every key point never reached. With no outline, outlinePoint, outlineIndex and status are null.
- notes: two to six, a mix of keep and fix, ordered by time. Titles are short sentences ("You rushed your result."). Bodies are one to three sentences on why it matters and what to try. Set cameraEventId to null for notes about speech.
- Camera notes (only when camera events are given): you may add up to two notes about eye contact, posture, gestures or expression. Each must set cameraEventId to the id of the event it is about, use that event's startMs, and may leave quote empty. Never mention a camera observation that has no event. Describe expression neutrally (smiling, brows lowered); never guess emotions.
- audienceFollowUp: the one follow-up question a sharp listener would ask next, and the reason you chose it.
- drills: one to three drills, each specific, repeatable and under ten minutes, aimed at the most important fix.
- storyBeats: find these beats in the answer. hook: the opening line that makes a listener want more. stakes: what was at risk, or why it mattered. turn: the moment things changed. payoff: the result. landing: the closing line that sums it up. For each beat present, give kind, the quote copied character for character from the transcript, and its startMs; each kind at most once. For each beat missing, give kind and one concrete suggestion of what to add, using the speaker's own words, names and points (for example 'Open with "the answers it refused were the right ones" before you explain.'). Never invent facts the speaker didn't say.
- landing: hasClearClose is true when the answer ends on a clear closing line. If it doesn't, suggestions holds up to two closing lines of 12 words or fewer, built only from the speaker's own words and points (you may add small linking words like and, so, the); otherwise an empty array.
- naturalPhrasing: up to three lines whose phrasing would sound non-native or unclear to an interviewer or audience (for example "so much joyful"). original is copied character for character from the transcript, like a quote; natural is how a native American English speaker would say it in this situation; why is one plain sentence. Keep the speaker's meaning exactly: change the wording, never what they said. Skip fillers and pacing, which other notes cover. If no line qualifies, return an empty array.

${CONTEXT_RULE}

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
  const stated = describeSpeakingContext(context.speakingContext);
  if (stated) parts.push(stated);
  if (context.talkType) parts.push(`Kind of talk: ${context.talkType}`);
  if (context.situation?.label) {
    const criteria = (context.situation.criteria ?? []).map((c) => `  - ${c}`).join('\n');
    const limit = context.situation.timeLimitMs ? ` Target length: under ${Math.round(context.situation.timeLimitMs / 1000)} seconds.` : '';
    parts.push(`Situation: ${context.situation.label}.${limit} A good answer here:\n${criteria}\nJudge the answer against these criteria.`);
  }
  if (context.mode) parts.push(`Session mode: ${context.mode}`);
  if (context.durationMs) parts.push(`Duration: ${clock(context.durationMs)} (${Math.round(context.durationMs)} ms)`);
  if (context.paceZone) parts.push(`Target pace: ${context.paceZone.min} to ${context.paceZone.max} wpm`);
  if (context.story) {
    const points = (context.story.keyPoints ?? []).map((p, i) => `  ${i + 1}. ${p}`).join('\n');
    parts.push(`Story Bank outline, "${context.story.title}":\n${points || '  (no key points)'}`);
  } else {
    parts.push('Story Bank outline: none chosen.');
  }
  if (context.previousFix) parts.push(`Previous take's one fix (judge whether this take achieved it): ${context.previousFix}`);
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
