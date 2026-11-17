# Build progress

The Phases 1–5 build: one branch, one PR and one green CI run per phase, in order. A new session resumes from this file alone: find the first feature not marked done, check out its phase branch (or branch from `main` if the phase hasn't started), read `docs/DECISIONS.md`, and carry on.

Status: **done** (built, tested, committed), **in progress**, **not started**, **UNVERIFIED** (built but needs a key, an account or a person to confirm).

## Phase 1: Proof (branch `feat/phase-1-proof`)

| Feature | Status | Notes |
| :--- | :--- | :--- |
| 1.1 Accuracy report | done | `npm run eval -- --report` writes `docs/accuracy.md` and `src/data/accuracy.json`; `npm run eval:readme` fills the README. 0 real recordings so far, so nothing is published. |
| 1.2 How this was scored | done | `src/lib/scoreExplanations.ts` feeds the `HowScored` disclosure (field notes scores, Before and after, Home numbers), the PDF and `docs/scoring.md` (`npm run docs`). A render test checks every `[data-score]` has one. |
| 1.3 Fix adoption | done | Schema: `oneFix.targetMetric` + `direction` (server-normalised). `src/lib/fixAdoption.ts` thresholds and tolerances. Shown on Before and after, Home ("Fixes adopted on a retake") and the PDF. UNVERIFIED with a live model: the prompt change needs one real session to confirm models fill `targetMetric` well. |
| 1.4 Trust page | done | `/trust`, linked from the launch footer, Home and the README. Generated from `src/data/dataFlows.ts`, which also writes the README Privacy lists (`npm run docs`, checked by a test). Screenshot checked in headless Edge. Added Vercel hosting logs and Google Fonts to the data flows: they were missing. |

PR: [#16](https://github.com/manoj2883/Vireo/pull/16), merged with CI green.

## Phase 2: The story coach (branch `feat/phase-2-story-coach`)

| Feature | Status | Notes |
| :--- | :--- | :--- |
| 2.1 Context setup | done | Optional "Who's it for?" step on the warm-up (`ContextStep`). Stored as `config.context`, re-checked by `server/llm/context.js`, sent to field notes and tightening; `CONTEXT_RULE` in both system prompts. Roleplay picks it up in Phase 4. |
| 2.2 Story beat map | not started | Sonogram already has `bands` and `markers` props for 2.2, 2.3 and 2.6. |
| 2.3 Attention timeline | not started | |
| 2.4 Landing line coach | not started | |
| 2.5 Story Bank interviewer | not started | |
| 2.6 Lightness cues | not started | |

PR: not opened yet.

## Phase 3: A coach that knows you

Not started.

## Phase 4: Real practice

Not started.

## Phase 5: Scale (local-first)

Not started.

## Open questions for the owner

- None yet.
