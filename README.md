# Idea Generator Pipeline

## What This Is

A multi-agent AI pipeline that generates, stress-tests, and ranks novel ideas. It combines research from 33 academic papers and 78 creativity techniques into a structured workflow that systematically overcomes the known failure modes of naive AI brainstorming: homogenization, mode collapse, fixation, and unreliable self-evaluation.

**Current focus:** Business and startup ideas — particularly calm, profitable businesses rather than venture-scale moonshots.

**Long-term vision:** A general-purpose idea generation engine that works across domains — product design, scientific research, creative projects, social innovation, personal problem-solving. The pipeline architecture is domain-agnostic by design; the domain expertise lives in the prompts and scanner configurations, not in the orchestration logic.

## The Core Insight

> "Repetitive AI ideas are a knowledge acquisition problem, not a creativity problem."
> — Nova framework (Paper 13), which achieved 3.4× more unique novel ideas

Most "AI idea generators" are a single prompt asking an LLM to brainstorm. This produces 10 variations of the same mediocre idea because the AI defaults to statistically typical outputs. This project attacks that problem structurally:

- **Diverse inputs** → 4 parallel scanners gathering signals from different angles
- **Diverse generation** → 4 generators using different creative strategies on different LLM providers
- **Structural novelty** → automated comparison against existing solutions
- **Adversarial filtering** → evidence-based critique and multi-agent debate
- **Measured diversity** → embedding-based audit to catch hidden homogenization

## Tech Stack

- **Language:** TypeScript
- **Framework:** Next.js 15 (App Router)
- **AI SDK:** Vercel AI SDK (multi-provider: Anthropic, OpenAI, Google, DeepSeek)
- **Testing:** Vitest + MSW + Testing Library
- **Deployment:** Vercel (start) → AWS Lambda Durable Functions (scale)
- **State:** Upstash Redis

## Status

🚧 **Active development — architecture is evolving.**

This project is intentionally experimental. Every component — model selection, prompt strategies, pipeline steps, tool choices — is subject to testing, measurement, and replacement as we learn what actually produces the best ideas. If you're reading this code, expect to see things change.

## Getting Started

```bash
npm install
npm run dev        # Local dev server
npm test           # Run tests
npm run typecheck  # TypeScript check
npm run check-all  # Everything at once
```

Requires `.env.local` with API keys — see `.env.example`.

## Project Structure

```
src/
├── app/                # Next.js pages + API routes
├── lib/                # Shared utilities, types, AI config
│   ├── ai/             # Model registry + provider config
│   ├── types/          # Zod schemas (single source of truth)
│   └── utils/          # Result type, retry, helpers
├── pipeline/           # Core pipeline logic
│   ├── steps/          # One file per pipeline step
│   ├── scanners/       # Individual scanner implementations
│   ├── generators/     # Idea generation strategies
│   └── prompts/        # System prompt templates
├── components/         # React UI
└── __tests__/          # Tests mirror src/ structure
```

## Research Foundation

See `docs/research-base.md` for the full research synthesis. Key papers:

- **Verbalized Sampling** (Paper 12) — 2-3× diversity from one prompt change
- **Nova** (Paper 13) — 3.4× unique ideas via iterative plan→search→re-plan
- **Multi-Agent Debate** (Paper 19) — structured opposition beats self-reflection
- **SciMON** (Paper 14) — iterative novelty checking against existing work
- **Si et al.** (Paper 1) — pairwise ranking beats absolute scoring
- **Doshi & Hauser** (Paper 8) — AI improves individuals but homogenizes collectively