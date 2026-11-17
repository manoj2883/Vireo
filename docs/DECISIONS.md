# Decisions

Product decisions the build spec didn't cover, with the reasoning. Newest at the bottom of each phase.

## Phase 1

**D1. Accuracy intervals resample whole recordings.** Words within one recording aren't independent (same voice, same room), so the bootstrap draws recordings, not words. This gives honestly wide intervals until there are many recordings.

**D2. One generated accuracy file feeds the app.** `npm run eval -- --report` writes `src/data/accuracy.json` alongside `docs/accuracy.md`. The trust page and "How this was scored" read it, so the app never shows a number the report doesn't. With fewer than 10 real recordings the file has `published: false` and no metrics, and the app says "not yet published".

**D3. `eval:readme` re-runs the evaluation.** Rather than reading a possibly stale report file, it evaluates the labels again and fills the README table from the same code, so the README can't drift from the labels.

**D4. A "retake of the same prompt" is a retake series.** Fix adoption compares a take with the take before it in its series (sessions linked by "Try again with this fix"), the same pairing Before and after already uses. A fresh session that happens to reuse the question text isn't counted, because it didn't carry a fix.

**D5. The server sets a fix's direction.** The model names `targetMetric`; the server replaces `direction` with the canonical one from `FIX_DIRECTIONS`, so a model mistake can't flip the comparison.

**D6. Sentence-end pauses are a share, not a count.** "Sentence-end pauses of 600 ms+" is measured as the share of sentence ends (all but the last word, from Deepgram's punctuation) followed by a gap of at least 600 ms. A count would reward simply talking longer. With fewer than 3 sentence ends it's "not measured".

**D7. Adoption thresholds and core tolerances.** Fillers −0.5 a minute, time in zone +5 points, time to main point −3 s, sentence-end pauses +10 points, eye contact +10 points. A fix isn't adopted if fillers rise by more than 1 a minute or time in zone falls by more than 10 points. Each has a one-line reason in `src/lib/fixAdoption.ts`. These are judgement calls to revisit once the accuracy report shows how much the measures wobble between takes.

**D8. Targets without a study say so.** The pace zones and the "3 to 5 pauses a minute" guide are Vireo design choices with no cited study. "How this was scored" says that plainly, and Home now reads "Vireo's rule of thumb is 3 to 5" instead of "Good speakers land between 3 and 5".

**D9. Two fix verdicts, labelled apart.** Before and after keeps the model's quote-based verdict on the fix, now worded "The notes heard it in your words" / "The notes didn't hear it yet", above the measured "Fix adopted ✓" line, so the two can't be mistaken for one claim.

**D10. Generated docs are checked by a test.** `docs/scoring.md` is rendered from `src/lib/scoreExplanations.ts` by `npm run docs` (and by `eval --report`, since it quotes accuracy). A test fails when it's out of date.

**D11. The data-flow table now lists hosting and downloads.** Building the trust page showed two flows the README never mentioned: Vercel's standard request logs, and the page asking Google Fonts for the typefaces. Both are now rows in `src/data/dataFlows.ts`. Self-hosting the fonts would remove the Google Fonts row; that's left as a choice for the owner.

**D12. "Never infers emotion" names expression.** The camera reports smiling as a share of time. That's an observable expression, not a feeling, so the "Vireo never" list names visible expression among the observable signals and says it never reports what you felt.

## Phase 2

**D13. Context is cleaned when the session starts, not while typing.** The warm-up keeps the audience text as typed (so spaces work) and `cleanContext` trims and validates it in `start()`. The server re-checks it (`server/llm/context.js`), since a client can send anything.

**D14. "The user's own vocabulary" for a missing beat's suggestion.** A suggestion may use instruction words ("open with", "say why it mattered") plus at most 3 other words the speaker never said; beyond that the suggestion is dropped and the beat just shows as missing. Requiring zero new words would make most instructions impossible to write.

**D15. Landing lines use the tightened answer's word check.** "Built only from the user's own words" reuses `unsupportedWords` from `server/llm/tighten.js`: small linking words are allowed, any other new content word rejects the line.

**D16. What counts as re-engaging attention.** Signposts, examples, lighter moments, numbers (digits and number words), a capitalised word mid-sentence (a name or place), a sentence ending in "?", and the story beats the notes found. Stretches are measured from the first word to the last, so 90 s of preamble counts too.

**D17. Lightness cues every 105 s.** The spec says roughly every 90 to 120 s; cues sit at the midpoint, moved to the next sentence end within 20 s so they land at a natural break. Any lighter moment resets the clock. The three techniques rotate and their examples are generic, never about the speaker.

**D18. The interviewer's first question is asked locally.** "When was it, and where were you?" is always the right opener, so it costs no model call; the endpoint refuses a request with no answer yet.

**D19. Interview turns share the write limit.** Each turn is one model call, so it counts against the same per-visitor and per-IP hourly write limits as field notes, rather than adding a new limit and env var. A full interview is about 7 to 10 turns.

**D20. Interview slots are quotes; the script is checked like the tightened answer.** Each of the seven slots must be copied exactly from the speaker's answers or it's emptied. The 30-second script may use only the speaker's words plus linking words, at most 90 words (about 30 s at 150 wpm). A script that fails gets one repair round, then the turn fails and the answer stays in the box.

## Phase 3

**D21. A skill is a fix's target measure.** The five measurable targets from fix adoption are the skills. Fixes marked not measurable can't be adopted, so they don't count toward any skill.

**D22. "Across at least 2 sessions" means 2 different questions.** Every retake is its own session, so counting sessions would let one answer, memorised, master a skill. Mastery needs its adoptions to come from at least two retake series.

**D23. Mastery is enforced on the server.** The prompt is told the mastered skills, and `generateTeardown` also sends back any reply whose one fix targets one, with a repair message. A model can't quietly ignore skill memory.

**D24. Personal best: the same question first, then the same situation.** "Best" uses ghost pace's rule (most time in zone, then fewest fillers). Only earlier sessions count, so a take is never compared with itself or the future. Ghost pace stores a second best per situation (`situation:<id>`) so a new question still races your own best. Deleting a session deletes both, since they share its take id.

**D25. The weekly plan is a snapshot.** It's built from data alone (weakest practising skills by recent adoption rate, then skills not yet started; eye contact only once the camera has been used) and stored per ISO week, so it doesn't reshuffle mid-week as sessions come in. The week number rotates which drill each skill gets.

**D26. Phrasing categories: the classifier wins when it's sure.** Article, preposition, tense, plural and word-order changes are clear from the words alone; then the classifier's answer beats the model's label. Otherwise the model's `category` is used. A pattern must appear at least twice to show. It lives on Home under "Speaking English with confidence", the situation's own name, because the app has no separate view for it.

**D27. Confidence mode details.** Breathing is 4 s in and 6 s out for 60 s, skippable. "Camera-off first take" means the camera is never opened on a take that isn't a retake; retakes in confidence mode use the camera as normal. The HUD keeps the pause ring and, for timed pitches, the countdown (it's the limit, not feedback). Live captions and the rushing glow are hidden. Coach mode's spoken nudges follow the user's own coaching choice.

## Phase 4

**D28. Reminder drills are resolved when the link opens.** A calendar event can't know which skill will be weakest on the day, so rehearsal links carry `drill=auto` and the warm-up asks the weekly-plan logic for the weakest skill's drill from this device's sessions. The description names last time's drill as a fallback. The final rehearsal's link carries `final=1`, which sets `takeQuestions` so the field notes lead with the Q&A drill.

**D29. Uploads use Deepgram's pre-recorded API with a temporary token.** Deepgram's docs say temporary tokens work for pre-recorded `/listen` requests, so the browser decodes the file, encodes a 16 kHz mono WAV (about 29 MB for 15 minutes) and posts it straight to Deepgram. The Vercel function only grants the token, which counts as one session against the usage limits. Not yet tried from a real browser: if Deepgram's CORS refused it, the fallback would be streaming the decoded audio through the live socket.

**D30. Uploads don't set ghost pace.** An uploaded talk is a real event, not a rehearsal of a question, so it doesn't replace the best take that ghost pace replays.
