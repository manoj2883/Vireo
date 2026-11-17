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
