# Metrics accuracy

`npm run eval` measures how well Vireo's on-device metrics match what a person hears. It replays each labelled recording through the same pipeline a live session uses: 20 ms loudness frames into the pause detector, transcript chunks into the timeline, and the pace meter ticking ten times a second. Then it prints:

- **Filler precision and recall.** A predicted filler counts when it overlaps a labelled one. Each label matches at most once.
- **WPM mean absolute error**, once a second while you're speaking (after the first two seconds), against the pace computed from your labelled word timestamps.
- **Pause F1.** A predicted pause counts when it overlaps a labelled pause by at least half their combined span (IoU ≥ 0.5).

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

- `audio`: a WAV file under `eval/`, any sample rate, mono or stereo. Use `{ "synthetic": true }` to synthesise audio from the words, as the example does.
- `words`: every word you hear, fillers included.
- `fillers`: one span per filler. A phrase like "you know" is a single span.
- `pauses`: silences after speech has started that you'd count as pauses, longer than 300 ms.
- `asr` (optional): what the live transcriber returned and when, to replay real transcription timing. Without it, words arrive in chunks of four, 500 ms after the chunk's last word.

## Labelling in Audacity

1. Put the recording at `eval/recordings/<name>.wav`.
2. In Audacity, add three label tracks: one label per word, one per filler, one per pause. Select the span and press Ctrl+B.
3. Export each track with *File › Export › Export Labels*.
4. Run `npm run eval:import -- <name> words.txt fillers.txt pauses.txt` to write `eval/labels/<name>.json`.

## Tuning

Pace accuracy depends on how long transcription takes to arrive (`transcriptLatencyMs` on the live session, default 500 ms). With real `asr` timings in your labels, try a few values and keep the one with the lowest WPM error.
