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

## Layer 2 — Tech Scout v1.0

> To run the Layer 2 evaluation, visit
> http://localhost:3000/frame, fill the form, click Submit, and
> scroll to the "Scanner: tech_scout" section in the debug view.
> Walk through the checklist below.

1. **Non-zero signals.** A live run on the carol-full fixture
   returns at least one signal in `scanners.tech_scout.signals`.
   Zero signals on a real-domain founder is a smoke test failure.
2. **Signals are concrete, dated, and specific.** Each signal has a
   plausible title, a non-generic snippet (numbers, dates, names),
   and a `date` value. Generic SEO spam ("the best fraud tools in
   2026") is a fail.
3. **Expansion is richer than the directive.** The
   `expansion_plan.expanded_keywords` array is strictly larger than
   `directive.tech_scout.keywords` and contains synonyms or related
   terms (e.g. "anomaly detection" alongside "fraud detection"),
   not just the original list echoed back.
4. **Source coverage.** All 3 source_reports — `hn_algolia`,
   `arxiv`, `github` — have a `status` of `ok` or `ok_empty`. If
   every source is `timeout` or `denied`, the scanner is broken
   end-to-end.
5. **Anti-targets excluded.** No signal title or snippet contains
   any term from `profile.anti_targets.value`. Spot-check the
   carol fixture for "crypto" / "gambling" leakage.
6. **Cost ceiling.** `scanners.tech_scout.cost_usd` is under $0.20
   per scanner run on gpt-4o. Anything higher is a budget breach
   and should be flagged before shipping.
7. **Latency ceiling.** Total wall-clock time for the full
   pipeline (Layer 1 + Layer 2) stays under 90 seconds. The arxiv
   adapter contributes ~3s of mandatory rate-limit sleep per query.
8. **Debug view renders Scanner Report.** The admin debug page
   renders a "Scanner: tech_scout" section directly under the
   `cost_usd` line in `FrameDebugView`. Absence is a render
   regression.
9. **Per-source query visibility.** Each source row in the report
   shows the queries that ran for that adapter (the `queries_ran`
   labels), so reviewers can audit what was actually fetched.
10. **Signal listing is complete.** Every entry in the signals
    list shows title + URL + score + snippet + category. Missing
    any of these fields means the renderer is dropping data.
11. **Expansion plan is visible.** The expansion plan is rendered
    inside the expandable `<details>` element so reviewers can
    audit the LLM-derived keywords without scrolling through raw
    JSON.
12. **Warnings/errors surface.** When the scanner produces
    warnings or errors, both lists appear in their own callouts in
    the debug view rather than being silently swallowed.
13. **Smell test.** Read the signals out loud. Are they actually
    about the founder's stated domain (e.g. SOC-2 audit tooling
    for Carol), or random tech that happened to match a keyword?
    Off-domain signals indicate the directive or expansion phase
    is too broad — fix the prompt before shipping.
