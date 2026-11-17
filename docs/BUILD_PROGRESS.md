# Build progress

The Phases 1–5 build: one branch, one PR and one green CI run per phase, in order. A new session resumes from this file alone: find the first feature not marked done, check out its phase branch (or branch from `main` if the phase hasn't started), read `docs/DECISIONS.md`, and carry on.

Status: **done** (built, tested, committed), **in progress**, **not started**, **UNVERIFIED** (built but needs a key, an account or a person to confirm).

## Phase 1: Proof (branch `feat/phase-1-proof`)

| Feature | Status | Notes |
| :--- | :--- | :--- |
| 1.1 Accuracy report | done | `npm run eval -- --report` writes `docs/accuracy.md` and `src/data/accuracy.json`; `npm run eval:readme` fills the README. 0 real recordings so far, so nothing is published. |
| 1.2 How this was scored | done | `src/lib/scoreExplanations.ts` feeds the `HowScored` disclosure (field notes scores, Before and after, Home numbers), the PDF and `docs/scoring.md` (`npm run docs`). A render test checks every `[data-score]` has one. |
| 1.3 Fix adoption | done | Schema: `oneFix.targetMetric` + `direction` (server-normalised). `src/lib/fixAdoption.ts` thresholds and tolerances. Shown on Before and after, Home ("Fixes adopted on a retake") and the PDF. UNVERIFIED with a live model: the prompt change needs one real session to confirm models fill `targetMetric` well. |
| 1.4 Trust page | not started | |

PR: not opened yet.

## Phase 2: The story coach

Not started.

## Phase 3: A coach that knows you

Not started.

## Phase 4: Real practice

Not started.

## Phase 5: Scale (local-first)

Not started.

## Open questions for the owner

- None yet.
