# Frame Layer Evaluation Rubric

A manual review checklist for Layer 1 (Frame) output. Run the rubric on
every golden fixture before shipping any change that touches the Frame
pipeline, prompts, or schemas.

## How to run

Pick a fixture and produce its FrameOutput either via the CLI:

```
npm run frame:dry-run -- src/__tests__/pipeline/frame/fixtures/alice-minimum.json
```

or via the debug page:

```
npm run dev
# then open http://localhost:3000/debug/frame
```

Load the fixture from the dropdown and click Run Frame. Walk the ten
items below. Any "no" answer is a blocker — fix before shipping.

## Checklist

1. **Source tagging is correct.** Every profile field is tagged
   `stated`, `inferred`, or `assumed`. Fields the user typed into the
   form are tagged `stated`; fields pulled out of
   `additional_context` by the LLM are `inferred`; anything filled
   from `ASSUMED_DEFAULTS` is `assumed`.
2. **No misclassified confidence.** Scan the table. If a stated field
   is tagged `inferred`, the extractor is merging incorrectly. If an
   assumed field is tagged `stated`, the builder is lying.
3. **Narrative reads naturally.** Prose is under 300 words, clearly
   mentions the mode, and references every required field (skills,
   time_per_week, money_available, ambition).
4. **Anti-targets are fully excluded.** Every scanner's `exclude`
   array contains every value from `profile.anti_targets.value`.
5. **Refine mode injects the existing idea.** In `refine` and
   `open_direction` mode, the existing idea description appears
   verbatim in the narrative AND in every scanner's `notes` field.
6. **Field coverage is complete.** For every `field -> consumer` pair
   declared in `FIELD_COVERAGE`, there is a matching trace entry in
   `debug.trace`. The orphan-detection invariant test enforces this
   in CI, but spot-check here too.
7. **Cost ceiling.** `debug.cost_usd` is less than $0.05 for a
   single run on gpt-4o.
8. **Latency ceiling.** Wall-clock time from request to FrameOutput
   is under 10 seconds for a single-threaded, unstreamed run.
9. **Debug page renders.** `/debug/frame` renders the FrameOutput
   for this fixture without any errors in the browser console.
10. **Smell test.** Read the narrative out loud. Does it sound like
    the founder described themselves, or does it sound like a bland
    corporate pitch deck? Quirks, specifics, and insider references
    should survive Frame; generic "driven entrepreneur" boilerplate
    should not.

## Fixtures

Run the rubric on each of these:

- `src/__tests__/pipeline/frame/fixtures/alice-minimum.json` —
  minimum-viable input
- `src/__tests__/pipeline/frame/fixtures/bob-medium.json` —
  medium-completeness with extractable context
- `src/__tests__/pipeline/frame/fixtures/carol-full.json` —
  full profile with refine mode
- `src/__tests__/pipeline/frame/fixtures/dave-nonenglish.json` —
  non-English additional context stress test
- `src/__tests__/pipeline/frame/fixtures/eve-adversarial.json` —
  adversarial input attempting prompt injection
