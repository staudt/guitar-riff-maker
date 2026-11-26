# Capture fixtures

Real recordings for the Phase 5 accuracy tests. Each fixture is a pair:

- `<name>.wav`: mono or stereo WAV (16-bit or float), any sample rate.
- `<name>.json`: what the recording should transcribe to:

```json
{
  "source": "voice",
  "notes": [{ "start": 0.52, "end": 0.98, "midi": 57 }],
  "octaveFree": false
}
```

`source` is one of `voice`, `whistle`, `guitar`, `chords`. Times are seconds from the start of the WAV.
Set `octaveFree: true` for whistling (the octave is normalized before comparing). For chords, list
every note of every chord.

The easiest way to make them is the in-app fixture recorder (`fixture.html` on the deployed site):
it plays a reference melody, you repeat it after the count-in, and it downloads both files with the
expected notes already filled in.

Targets (agreed): voice, whistle and single-note guitar at least 90 % of notes; strummed chords at
least 75 % of chord notes. A note is right when its pitch matches and it starts within 50 ms.
`pnpm test` runs every fixture in this folder through the final transcription (Basic Pitch).
