Phase A: Foundation (do first)
  1. Result type + retry utility + AI client config
  2. Zod schemas for all pipeline data types
  3. MSW mocks + test setup
  → Run tests, verify infrastructure works

Phase B: Scanners (parallel-friendly)
  4. Tech Scout scanner + tests
  5. Pain Scanner + tests
  6. Market Scanner + tests
  7. Change Scanner + tests
  → Run all scanner tests together

Phase C: Core Pipeline
  8. Aggregator step + tests
  9. 4 Generators + tests
  10. Novelty checker + tests
  11. Critic + debate logic + tests
  12. Synthesizer + tests
  13. Ranker (pairwise) + tests
  14. Diversity audit + tests
  → Full pipeline integration test

Phase D: API & UI
  15. Pipeline API routes
  16. Frontend dashboard
  17. Streaming + real-time progress
  → End-to-end test