# Frame layer test fixtures

Each JSON file is a valid `FrameInput` used by Layer 1 tests. They cover a
range from bare minimum to adversarial. All five must parse through
`FRAME_INPUT_SCHEMA` (enforced by `fixtures.test.ts`).

| Fixture | Purpose |
|---|---|
| alice-minimum.json | Only the 4 required fields + explore mode. Tests assumption-filling. |
| bob-medium.json | Required + some optional + additional_context mentioning an extractable audience. Tests form + context merge. |
| carol-full.json | Everything filled, refine mode with anchor idea. Used by orphan-detection invariant tests. |
| dave-nonenglish.json | Additional context in Spanish. Tests robustness. |
| eve-adversarial.json | Additional context contains prompt-injection attempts. Tests delimiter defense. |
