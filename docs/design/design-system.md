# Vireo

Vireo is a real-time speech coach. Its visual idea is **a field guide to your voice**: ornithologists draw birdsong as sonograms, so Vireo draws a person's speech the same way and pins field-guide notes to the moments that matter, such as a filler, a rushed result, or a pause that landed.

This system covers the launch page, the LinkedIn carousel and the app (warm-up, live session, field notes, home, Story Bank). It is built for React with Tailwind, shadcn/ui and Motion; every token maps to a CSS variable so shadcn's theme slots can point at them.

## The signature: the sonogram

Speech is drawn as three stacked harmonic strokes per word: a thick fundamental, a medium second harmonic and a thin third, at falling opacity. Everything else in the system supports this one picture.

- Normal speech: `olive` strokes with a gentle pitch contour.
- Fillers: flat `amber` strokes. A filler is a monotone hum, so it is drawn flat. The shape carries the meaning even without colour.
- Rushed passages: words squeezed together with a busier contour.
- Pauses: real gaps, labelled with a `sky` bracket.
- Annotations: Newsreader italic, set above the trace with a thin bracket, written like a naturalist's note ("a pause that landed").

Draw the sonogram in one place per screen, and give it room.

## Principles

**Glanceable while speaking.** Live feedback uses position, shape and colour: a dot drifting through a zone, a ring filling, a frame warming. Sentences wait for the field notes.

**Coach, not judge.** Speaking feedback never uses `alert`. `amber` means "notice this". Notes are labelled "Keep this" and "Fix next", never "error" or "bad".

**Show the evidence.** Every note quotes the exact words and the time they were said. If Vireo can't back a note with a quote, it leaves the note out.

**One bold thing.** Each screen spends its boldness once: the sonogram on the launch page, the live frame in a session, the verdict headline in field notes. Everything around it stays quiet.

## Voice

Plain, warm and specific. Talk to the speaker as "you". Name what happened, then what to try.

- Good: "You rushed your result. Your pace hit 184 wpm the moment you reached the finding."
- Avoid: "Pacing issues detected." "Great job!!" "You failed to pause."

Sentence case everywhere. No all-caps labels, no labels stacked above headings, no arrows appended to links.

## Colour

Two themes. **Dawn chorus** (dark, the default) is a pre-dawn indigo with luminous traces. **Field guide** (light) is ink on cool paper. In dark mode, field-note cards flip to paper (`ink` fill, `surface-000` text) so evidence reads like a page torn from a notebook.

| Token | Means |
|---|---|
| `olive` | Speech, on target, primary action, "keep this" |
| `amber` | Notice this: fillers, rushing, "fix next" |
| `sky` | Pauses and breath |
| `alert` | Recording dot and destructive actions only |

Colour is never the only signal: fillers are flat, filler ticks are triangles, the rushing pace dot grows a ring.

## Type

- **Newsreader** for headlines, verdicts, note titles, big numbers and italic annotations. Set large and tight (−0.035em at display sizes).
- **Schibsted Grotesk** for interface text and transcripts, with tabular figures on so live numbers don't jitter.

Both are Google Fonts.

## Layout and motion

- Generous space between sections (`space-24`), left-aligned content, a 1240px container.
- Lists are separated by hairline rules, not boxed into identical cards.
- One orchestrated motion per screen: the sonogram drawing itself in on the launch page, the live HUD in a session. Springs, not linear tweens. With `prefers-reduced-motion`, show the finished state.

## Components

- **PaceBand**: live pace as a dot in a target zone, with a faint ghost dot for your best take.
- **PauseRing**: fills in teal during a pause.
- **FillerTicker**: running count with triangle ticks that fade.
- **ModeSwitch**: Watch silently or Coach me out loud.
- **EvidenceCard**: a field note with its quoted evidence.
- **Button**: primary pill, outline pill, and the end-session button.
