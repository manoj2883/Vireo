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
| 2.2 Story beat map | done | `storyBeats` in the field notes schema; `server/llm/story.js` checks quotes and keeps a missing beat's suggestion only if it stays in the speaker's vocabulary. Sky markers on the sonogram plus a beat strip (`StoryBeats`). UNVERIFIED with a live model. |
| 2.3 Attention timeline | done | `src/lib/attention.ts` and `src/lib/attentionPatterns.ts`, no model. Soft amber bands on the field notes sonogram; nothing under 90 s. |
| 2.4 Landing line coach | done | `landing` in the schema; lines over 12 words or with words the speaker never said are rejected (`isValidLandingLine`, tested). `LandingLine` card. |
| 2.5 Story Bank interviewer | done | `server/llm/interview.js` (schema, prompt, evidence check: slots must quote the answers, script uses only their words, 90 words max) behind `POST /api/story-interview` (write-limited per turn). `StoryInterviewer` panel in the Story Bank; Save or "Rehearse this story" (warm-up preset with its key points). New data-flow row. UNVERIFIED with a live model. |
| 2.6 Lightness cues | done | `lightnessCues` in `src/lib/attention.ts`: every 105 s of speech with no lighter moment, snapped to a sentence end. Shows place plus a technique (callback, rule of three, understatement); never writes a joke. |

PR: [#17](https://github.com/manoj2883/Vireo/pull/17), merged with CI green.

## Phase 3: A coach that knows you (branch `feat/phase-3-coach-knows-you`)

| Feature | Status | Notes |
| :--- | :--- | :--- |
| 3.1 Skill memory | done | `src/lib/skills.ts` (skill = fix target; mastered = adopted 3 of last 4 across 2 questions). Field notes get `masteredSkills`; the server sends back a one fix that targets one (repair round). "Your skills" on Home, grouped by status. |
| 3.2 Your own best as the bar | done | `src/lib/personalBest.ts`: best earlier take on this question, else this situation. Field notes scores compare with it; the request carries `personalBest`; `PERSONAL_STYLE_RULE` in the prompt. Ghost pace falls back to the situation's best (`situation:<id>` ghost key). |
| 3.3 Weekly plan | done | `src/lib/weeklyPlan.ts` + drill library; snapshot per ISO week in IndexedDB settings (`weeklyPlanFor`). "This week's plan" on Home; each drill opens the warm-up with it preset. |
| 3.4 Natural phrasing trends | done | `category` on each "say it more naturally" item; `src/lib/phrasing.ts` classifier (wins when sure) plus the model's label; top 3 recurring patterns with the speaker's own examples in "Speaking English with confidence" on Home. |
| 3.5 Confidence mode | done | Warm-up switch. 60 s breathing (`BreathingWarmUp`, reduced motion keeps the circle still), camera never opened on the first take, HUD is the pause ring only, field notes open with "What went well" and the prompt leads with it. |

PR: not opened yet.

## Phase 4: Real practice

Not started.

## Phase 5: Scale (local-first)

Not started.

## Open questions for the owner

- None yet.
