# How Vireo scores

<!-- Generated from src/lib/scoreExplanations.ts by `npm run docs`. Do not edit by hand. -->

Every score and headline number in Vireo has a “How this was scored” note under it. This page collects them. In the app, each note also shows that session’s real inputs.

## Structure

**What it measures.** Whether the answer had a point, an order and a landing.

**How.** A 0 to 100 judgement by the field notes model, reading your transcript against the situation’s criteria (and your Story Bank outline, if you chose one).

**Target.** Your best earlier structure score on this question (or, failing that, this situation). *Source:* Your own sessions on this device.

**Accuracy.** Scored by the field notes model. This is a model’s judgement, not a measurement, so it has no accuracy figure.

## Delivery

**What it measures.** Pace, fillers and pauses, as a listener would feel them.

**How.** A 0 to 100 judgement by the field notes model, given the pace, filler and pause numbers measured on your device.

**Target.** Your best earlier delivery score on this question (or, failing that, this situation). *Source:* Your own sessions on this device.

**Accuracy.** Scored by the field notes model. This is a model’s judgement, not a measurement, so it has no accuracy figure.

## Clarity

**What it measures.** How concrete, precise and easy to follow the answer was.

**How.** A 0 to 100 judgement by the field notes model, reading your transcript.

**Target.** Your best earlier clarity score on this question (or, failing that, this situation). *Source:* Your own sessions on this device.

**Accuracy.** Scored by the field notes model. This is a model’s judgement, not a measurement, so it has no accuracy figure.

## Fillers a minute

**What it measures.** How often you said a filler such as “um”, “uh”, “like” or “you know”.

**How.** Fillers in the transcript ÷ session length in minutes, to one decimal place. A phrase like “you know” counts once. Sounds with no transcribed word are shown faintly but never counted.

**Target.** No fixed target: fewer is better, and Vireo compares you with your own earlier takes. *Source:* Vireo doesn’t set a filler target, because a few fillers are normal in natural speech.

**Accuracy.** Accuracy not yet published: it needs at least 10 hand-labelled recordings (0 so far).

## Time in your pace zone

**What it measures.** The share of your speaking time spent at a comfortable pace for this kind of talk.

**How.** Pace is read about once a second while you speak (words per minute over a rolling window, leaving out long pauses). Time in zone = readings inside the zone ÷ all readings, as a percentage.

**Target.** As much time as possible inside your zone. *Source:* Vireo’s design target for this kind of talk, set when the situations were designed. It isn’t taken from a published study.

**Accuracy.** Accuracy not yet published: it needs at least 10 hand-labelled recordings (0 so far).

## Pauses a minute

**What it measures.** How often you held a deliberate silence.

**How.** Silences longer than 300 ms after you start speaking, found from the microphone’s loudness on your device, ÷ session length in minutes.

**Target.** 3 to 5 a minute. *Source:* Vireo’s rule of thumb from its design, not from a published study.

**Accuracy.** Accuracy not yet published: it needs at least 10 hand-labelled recordings (0 so far).

## Eye contact

**What it measures.** The share of the session you were looking at the camera.

**How.** Face direction is estimated on your device about ten times a second with MediaPipe, against your two-second calibration. Eye contact = time facing the camera ÷ time your face was tracked.

**Target.** No fixed target: more is usually better. *Source:* Vireo doesn’t set an eye-contact target.

**Accuracy.** Accuracy not yet published: the camera estimate hasn’t been tested against labelled video.

## Time to your main point

**What it measures.** How long before you said the sentence that answers the question.

**How.** The field notes model marks the moment you first state your main point; its time from the start of the session is shown. If you never stated it, nothing is shown.

**Target.** Sooner is usually better. *Source:* Vireo doesn’t set a target outside job interviews.

**Accuracy.** Scored by the field notes model. This is a model’s judgement, not a measurement, so it has no accuracy figure.

## Fix adopted

**What it measures.** Whether this retake actually did the one fix from the take before.

**How.** Each fix names one measure it should move. The fix counts as adopted when that measure improves by at least its threshold (fillers: 0.5 a minute; time in your pace zone: 5%; time to your main point: 3.0 s; sentence ends with a 600 ms pause: 10%; eye contact: 10%) and no core measure clearly gets worse (fillers by more than 1.0 a minute, time in your pace zone by more than 10%). Sentence-end pauses count a pause of 600 ms or more after a sentence.

**Target.** Adopt the fix on the next take. *Source:* Vireo’s practice loop: one fix, then take it again.

**Accuracy.** Counted directly from your sessions, so there’s nothing to estimate.

## Fixes adopted

**What it measures.** Of your retakes where the fix could be measured, how many adopted it.

**How.** Retakes whose fix was adopted ÷ retakes whose fix could be measured. Shown once there are at least 3. Worked out on this device from your sessions; nothing is sent anywhere.

**Accuracy.** Counted directly from your sessions, so there’s nothing to estimate.

## Practised this week

**What it measures.** Total speaking time in the last seven days.

**How.** The lengths of every session in the last seven days, added up and rounded to the nearest minute.

**Accuracy.** Counted directly from your sessions, so there’s nothing to estimate.

## Follow-up questions waiting

**What it measures.** Audience mode follow-up questions you haven’t answered yet.

**How.** Sessions with Audience mode on whose follow-up hasn’t been answered in a later session.

**Accuracy.** Counted directly from your sessions, so there’s nothing to estimate.
