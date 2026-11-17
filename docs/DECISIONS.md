# Decisions

Product decisions the build spec didn't cover, with the reasoning. Newest at the bottom of each phase.

## Phase 1

**D1. Accuracy intervals resample whole recordings.** Words within one recording aren't independent (same voice, same room), so the bootstrap draws recordings, not words. This gives honestly wide intervals until there are many recordings.

**D2. One generated accuracy file feeds the app.** `npm run eval -- --report` writes `src/data/accuracy.json` alongside `docs/accuracy.md`. The trust page and "How this was scored" read it, so the app never shows a number the report doesn't. With fewer than 10 real recordings the file has `published: false` and no metrics, and the app says "not yet published".

**D3. `eval:readme` re-runs the evaluation.** Rather than reading a possibly stale report file, it evaluates the labels again and fills the README table from the same code, so the README can't drift from the labels.
