# Labelling recordings for Vireo's accuracy report

Vireo says how accurate its pace, pause and filler numbers are only once it can prove it. That needs real recordings that a person has labelled by ear. Each clip takes about ten minutes to label. No numbers are published until there are at least 10.

## The 10-minute version

1. **Record** (1 min). A 60 to 90 second clip from the checklist below. Use your normal microphone in a normal room. Save it as a WAV file: `eval/recordings/<name>.wav`, for example `interview-fast-01.wav`.
2. **Open it in [Audacity](https://www.audacityteam.org/)** (free). Add three label tracks with *Tracks › Add New › Label Track*. Name them `words`, `fillers` and `pauses`.
3. **Label the words** (5 min). In the `words` track, select each word and press Ctrl+B (Cmd+B on a Mac), then type it. Include fillers like "um" as words too. Zoom in (Ctrl+1) so the edges sit where the sound starts and stops. Don't agonise: within about 50 ms is fine.
4. **Label the fillers** (1 min). In the `fillers` track, one label per filler: "um", "uh", "like" used as a filler, "you know", "I mean", "sort of". A phrase like "you know" is one label.
5. **Label the pauses** (2 min). In the `pauses` track, one label for each silence longer than about 300 ms, after you've started speaking. Breaths between sentences count if they're silent.
6. **Export and import** (1 min). For each track, *File › Export › Export Labels* to a text file. Then run:

   ```bash
   npm run eval:import -- <name> words.txt fillers.txt pauses.txt
   ```

   This writes `eval/labels/<name>.json`.
7. **Check it runs:** `npm run eval -- <name>.json`.

When you have 10 or more, `npm run eval -- --report` writes [`docs/accuracy.md`](../docs/accuracy.md) and the app's accuracy file, and `npm run eval:readme` updates the README table. Both leave out the synthetic example.

**Privacy:** a recording in `eval/recordings/` is your own voice. Only commit it if you're happy for it to be public, and never record someone else without their written consent.

## The 30 clips

Aim for variety: the report is only as good as the range of speech it's tested on. Tick these off as you go. Each line is one clip of 60 to 90 seconds.

**Job interview**

- [ ] 1. "Tell me about yourself", at your normal pace
- [ ] 2. "Tell me about yourself", deliberately fast (aim for 180+ wpm)
- [ ] 3. "A time you solved a hard problem", with a few natural "um"s
- [ ] 4. "Why do you want this role?", with long thinking pauses
- [ ] 5. A weakness question, answered slowly and carefully
- [ ] 6. Any question, read from a script (very few fillers)

**Presentation or class talk**

- [ ] 7. Explain your project, normal pace
- [ ] 8. Explain your project, with signposts ("first", "the key point")
- [ ] 9. Walk through results with numbers in it ("forty-two percent")
- [ ] 10. Teach one concept, slowly, with pauses for effect
- [ ] 11. A talk with lots of "so" and "like"
- [ ] 12. A talk in a slightly noisy room (fan, café sound)

**60-second pitch**

- [ ] 13. Pitch a project, energetic and fast
- [ ] 14. Pitch yourself, calm and steady
- [ ] 15. Pitch with a false start and a restart ("So the... the problem is")
- [ ] 16. Pitch that runs over 60 seconds

**Speaking English with confidence** (non-native speakers especially welcome)

- [ ] 17. Describe your city
- [ ] 18. Tell me about your week
- [ ] 19. Explain your job to a friend
- [ ] 20. Any topic, with an accent different from clips 17 to 19 (ask a friend, with consent)
- [ ] 21. Any topic, with self-corrections ("I go, I went there")

**Toast or big moment**

- [ ] 22. A wedding toast with pauses before the laughs
- [ ] 23. A farewell thank-you, warm and slow
- [ ] 24. Introducing a guest speaker, brisk

**Hard cases**

- [ ] 25. Whispering or very quiet speech
- [ ] 26. Loud, projected speech (as if to a room)
- [ ] 27. Lots of short pauses under half a second
- [ ] 28. A single very long pause (5 seconds or more)
- [ ] 29. Fillers that are real words: "like" as a verb, "you know" as a real question
- [ ] 30. Two takes of the same answer, the second following one fix (label both)

## What the numbers mean

`npm run eval` replays each labelled recording through the same pipeline a live session uses: 20 ms loudness frames into the pause detector, transcript chunks into the timeline, and the pace meter ticking ten times a second.

- **Filler precision:** of the fillers Vireo marked, the share that really were fillers. **Recall:** of the real fillers, the share Vireo caught. **F1** balances the two. A marked filler counts when it overlaps a labelled one; each label matches at most once.
- **Pace error:** once a second while you're speaking (after the first two seconds), the gap between Vireo's pace and the pace from your labelled word times, in words per minute. The report gives the mean gap and the share of seconds within ±10 wpm.
- **Pause precision, recall and F1:** as for fillers, but a pause counts only when it overlaps a labelled pause by at least half their combined span (IoU ≥ 0.5).
- **95% intervals:** the report resamples whole recordings 2,000 times (with a fixed seed, so it's repeatable) and shows the range the middle 95% of results fall in. Wide intervals mean more recordings are needed.

## Label format

One JSON file per recording in `eval/labels/`. Times are milliseconds from the start of the audio.

```json
{
  "audio": "recordings/interview-01.wav",
  "words":   [{ "text": "So", "startMs": 500, "endMs": 720 }],
  "fillers": [{ "text": "you know", "startMs": 9050, "endMs": 9620 }],
  "pauses":  [{ "startMs": 4100, "endMs": 5400 }],
  "asr":     [{ "atMs": 1300, "text": "So my research" }]
}
```

- `audio`: a WAV file under `eval/`, any sample rate, mono or stereo. `{ "synthetic": true }` synthesises audio from the words; the example uses this, and it never counts toward published numbers.
- `words`: every word you hear, fillers included.
- `fillers`: one span per filler.
- `pauses`: silences after speech has started, longer than 300 ms.
- `asr` (optional): what the live transcriber returned and when, to replay real transcription timing. Without it, words arrive in chunks of four, 500 ms after the chunk's last word.

## Tuning

Pace accuracy depends on how long transcription takes to arrive (`transcriptLatencyMs` on the live session, default 500 ms). With real `asr` timings in your labels, try a few values and keep the one with the lowest pace error.
