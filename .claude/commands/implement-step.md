Implement pipeline step: $ARGUMENTS

Follow this order exactly:
1. Create Zod input/output schemas in src/lib/types/
2. Write test file in src/__tests__/pipeline/steps/ with 3+ test cases
3. Run `npm test` — tests should FAIL (they test unwritten code)
4. Implement the step in src/pipeline/steps/
5. Run `npm test` — tests should PASS
6. Run `npm run typecheck`
7. Verify file is under 500 lines and functions under 30 lines