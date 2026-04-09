# Architecture — Idea Generation Pipeline

## ⚠️ This Architecture Is Alive

This document describes the CURRENT design. It is NOT frozen.

Every component — step ordering, model assignments, prompt strategies, tool
choices, scoring criteria — is a hypothesis to be tested. If you (Claude Code,
a contributor, or future-me) discover a better approach through testing,
new research, or experimentation:

1. Propose the change with reasoning
2. Explain what you expect to improve (quality, diversity, cost, speed)
3. Implement behind a feature flag or on a branch
4. Measure the difference
5. Replace the old approach if the new one wins

**The goal is not to preserve this architecture. The goal is to produce the
highest-quality, most diverse, most practically useful ideas possible — as
cheaply and efficiently as possible.**

---

## Design Philosophy

### What We're Optimizing For (in priority order)

1. **Idea quality** — novel, feasible, and worth building
2. **Idea diversity** — categorically different from each other, not variations
3. **Practical usefulness** — ideas a real person could act on this month
4. **Cost efficiency** — minimize API spend per pipeline run
5. **Speed** — complete pipeline in under 5 minutes

### Known Failure Modes We're Designing Against

These come from 33 research papers. Every architectural choice exists to
counter one or more of these:

| Failure Mode | What Happens | Our Countermeasure |
|---|---|---|
| **Homogenization** | AI makes each idea better but all ideas more similar | Multi-provider generators + diversity audit |
| **Mode collapse** | AI defaults to "statistically typical" outputs | Verbalized Sampling in all generators |
| **Fixation** | Seeing AI output too early locks in one direction | Aggregator outputs signals/facets, not finished ideas |
| **Degeneration-of-Thought** | AI agrees with itself when asked to reflect | Multi-Agent Debate with opposing roles |
| **Evaluation blindness** | AI can't reliably judge its own ideas | Pairwise comparison + human final decision |
| **Tarpit convergence** | Ideas that look good but have killed 100 startups | Evidence-based Critic with web search |

---

## Pipeline Overview

```
[User Input] → [Frame] → [Scan ×4 parallel] → [Aggregate]
    → [Generate ×4 parallel] → [Novelty Check] → [Critique + Debate]
    → [Synthesize] → [Rank] → [Diversity Audit] → [Human Decision]
```

**Hybrid architecture:** Pipeline/Sequential overall, with Parallel fanout
at scan and generate steps, and Peer-to-Peer debate at the critique step.

---

## Steps in Detail

### Step 0: Frame (User Input)

**Purpose:** Collect founder context — skills, domain expertise, data
advantages, network, constraints, anti-targets.

**Research basis:** Shane (2000) proved 8 teams looking at the same
invention each found different opportunities matching their expertise.
Your background determines which opportunities you can see.

**Input:** Freeform user answers to structured questions.
**Output:** Validated FounderProfile (Zod schema) consumed by all downstream steps.

---

### Step 1: Parallel Scanning (4 agents)

**Purpose:** Gather diverse, high-quality research signals from multiple
angles simultaneously.

**Research basis:** Nova (Paper 13) — repetitive ideas are a knowledge
acquisition problem. Better input = better output. 3.4× improvement.

| Scanner | What It Finds | Key Tools |
|---|---|---|
| Tech Scout | New capabilities, APIs, price drops | HN Algolia, arXiv, GitHub API |
| Pain Scanner | Complaints, frustrations, unmet needs | Reddit .json, web search, G2 reviews |
| Market Scanner | Competitors, funding, dead companies | YC directory, idea-reality-mcp |
| Change Scanner | Regulations, social shifts, market changes | Web search, Google Trends |

**Execution:** All 4 run in parallel via Promise.all().
**Output:** 15-25 signals per scanner, ~60-80 total.

**🔬 IMPROVEMENT OPPORTUNITIES:**
- Add more scanner types (academic, patent, geographic, demographic)
- Implement Nova's re-plan loop (plan→search→evaluate gaps→re-search)
- Add scanner for user-generated content beyond Reddit (Quora, Stack Overflow, niche forums)
- Consider specialized scanners per domain when expanding beyond business ideas

---

### Step 2: Research Aggregation

**Purpose:** Compress 60-80 signals into a structured brief under 4000
tokens without losing surprising outliers.

**Research basis:** Chain of Ideas (Paper 15) — temporal ordering reveals
trajectories. Scideator (Paper 25) — facet extraction enables recombination.

**Method:**
1. Embedding-based dedup (cosine similarity > 0.85 = merge)
2. Cluster related signals into themes
3. Extract facets per cluster: Problem, Mechanism, Evaluation criteria
4. Rank by novelty × pain × timing
5. Compress to structured output

**Output:** 15-20 ranked signal clusters with facets. Keywords and
signals — NOT fully-formed ideas (to avoid fixating generators, Paper 10).

**🔬 IMPROVEMENT OPPORTUNITIES:**
- Experiment with different embedding models for dedup quality
- Try LLM-based clustering vs. pure embedding clustering
- Test whether chronological ordering actually improves downstream ideas
- Add a "surprise signals" section for outliers that don't fit clusters

---

### Step 3: Parallel Idea Generation (4 agents)

**Purpose:** Maximum creative divergence. 4 generators × 5 ideas = 20 raw
ideas using different strategies on different LLM providers.

**Research basis:** Verbalized Sampling (Paper 12, score 95/100) — 2-3×
diversity. Differentiated Search (Paper 4b) — sequential divergence.
Far-field analogy (Dahl & Moreau) — distant domains produce more original ideas.

| Generator | Strategy | Model Provider |
|---|---|---|
| Recombinator | Combine 2-3 signal clusters | Configurable |
| Analogy Transferer | Borrow solutions from other industries | Configurable |
| Inverter | Flip assumptions, explore opposites | Configurable |
| User Empath | Start from a person's worst day | Configurable |

**All generators include:** Verbalized Sampling prompt ("estimate probability
a typical AI would suggest this — replace anything above 60%").

**Execution:** Parallel via Promise.all(). Later generators optionally see
earlier outputs for Differentiated Search.

**🔬 IMPROVEMENT OPPORTUNITIES:**
- Test more generator strategies (SCAMPER, TRIZ principles, future envisioning, fictionation)
- Experiment with model assignments — which model produces best ideas for which strategy?
- Try more than 4 generators (6? 8?) and measure quality vs. cost tradeoff
- Add constraint-based generators (fixed price point, specific tech stack, specific market size)
- Test "rough output" generators that produce keywords/fragments vs. full idea descriptions
- Consider generators for specific future domains (health, education, creative tools)

---

### Step 4: Novelty Check

**Purpose:** Verify each idea is genuinely novel by comparing against
existing solutions. Force revision if too similar.

**Research basis:** SciMON (Paper 14, score 92/100) — iterative
compare-and-revise until genuinely different.

**Method:**
1. For each idea: call idea-reality-mcp (scans 6 sources in parallel)
2. Compute embedding similarity between all 20 ideas internally
3. Flag ideas with reality_signal > 60 or internal similarity > 0.75
4. Loop flagged ideas back to generator: "too similar to [X] — revise"
5. Repeat 2-3 times

**🔬 IMPROVEMENT OPPORTUNITIES:**
- Add patent database search for deeper novelty checking
- Experiment with similarity thresholds (is 0.75 the right cutoff?)
- Try novelty checking against different corpora (academic, patent, product databases)
- Consider "novelty along which dimension" — novel market, novel tech, novel business model?

---

### Step 5: Adversarial Critique + Debate

**Purpose:** Kill bad ideas with evidence. Stress-test survivors through
structured multi-agent debate.

**Research basis:** Devil's Advocate (Paper 21, score 93/100) — mandatory
opposition improves quality. MAD (Paper 19, score 95/100) — debate beats
self-reflection. Critical finding: MODERATE disagreement produces best results.

**Phase A — Kill Tests (all 20 ideas):**
1. Tarpit check (search for dead startups that tried this)
2. Moat check (can someone copy this in a weekend?)
3. Platform risk (will OpenAI/Google add this as a feature?)
4. Willingness to pay (would someone pay THIS MONTH?)
5. LLM failure mode (what happens when the AI is wrong?)

**Phase B — Debate (top 6-8 survivors):**
- Architect: builds strongest case FOR
- Destroyer: finds every flaw with EVIDENCE
- Judge: extracts truth from both sides, confidence score 0-100
- 2-3 rounds of back-and-forth
- If confidence < 70, trigger another round

**🔬 IMPROVEMENT OPPORTUNITIES:**
- Test different kill criteria for different domains
- Experiment with debate round count (2 vs 3 vs 4)
- Try different model providers for Architect vs Destroyer
- Add an "Outsider" perspective agent (cross-domain challenger)
- Measure whether debate actually improves final idea selection quality
- Consider domain-expert personas for the debate participants

---

### Step 6: Synthesis & Structuring

**Purpose:** Turn rough surviving ideas into structured business concepts.

**Research basis:** CLEAR IDEAS (2022) — implementation thinking
paradoxically boosts originality. Paper 30 — question-driven coaching
preserves ownership better than AI rewriting.

**Output per idea:** Business model, target customer persona, MVP
definition (buildable in 2-4 weeks), unfair advantage analysis,
12-month vision, biggest risk + mitigation.

**🔬 IMPROVEMENT OPPORTUNITIES:**
- Adapt output template per domain (business vs. research vs. creative)
- Test whether adding competitive positioning improves actionability
- Experiment with different synthesis depth (lean one-pager vs. detailed brief)

---

### Step 7: Ranking & Selection

**Purpose:** Reliable prioritization using pairwise comparison, not
absolute scores. Humans make the final call.

**Research basis:** Si et al. (Paper 1, score 88/100) — pairwise beats
absolute scoring. Paper 5 — different models have systematic biases;
multi-model voting cancels them.

**Method:**
1. Pairwise tournament: every pair compared head-to-head
2. Criteria: pain intensity, willingness to pay, feasibility, moat,
   founder fit, market timing, platform risk
3. Optionally run on 2-3 different models and majority-vote
4. Present ranked list with full reasoning to HUMAN
5. Human makes final decision

**🔬 IMPROVEMENT OPPORTUNITIES:**
- Test different ranking criteria for different domains
- Experiment with ELO/Swiss System tournament for larger idea pools
- Measure whether multi-model voting actually improves ranking reliability
- Consider crowd-sourced evaluation (show ideas to test audience)
- Build calibration: track which ranked ideas actually succeed over time

---

### Step 8: Diversity Audit

**Purpose:** Final check — are the surviving ideas genuinely different
from each other, or are they secretly variations of the same concept?

**Research basis:** Doshi & Hauser (Paper 8) — AI-assisted ideas are 5%
more similar to each other. This step catches hidden homogenization.

**Method:**
1. Embed all final ideas
2. Compute average pairwise cosine similarity
3. If avg > 0.7: FAIL — force re-divergence with new constraints
4. Optionally visualize with UMAP for intuition

**If audit fails:** Ban the over-represented direction, re-run generation
with different strategy, re-audit.

---

## Data Flow

Every step communicates via Zod-validated schemas. No untyped data flows
between steps. The schemas ARE the contract.

```
FounderProfile → ScannerOutput[] → AggregatedBrief
  → GeneratedIdea[] → NoveltyCheckedIdea[] → CritiqueResult[]
  → BusinessConcept[] → RankedIdea[] → DiversityReport
```

All intermediate state is persisted to Redis so:
- Pipeline can resume from any step after failure
- Results can be inspected and debugged
- Steps can be re-run independently with different parameters

---

## Model Strategy

Models are assigned per pipeline role, not hardcoded per step. The
assignment lives in `src/lib/ai/models.ts` and is the ONLY place model
strings appear in the codebase.

**Current philosophy:** Use different providers for different roles to
maximize diversity and cancel biases (Paper 5). Experiment freely with
assignments.

**Cost management:** Use cheaper models (DeepSeek, GPT-4o-mini, Gemini
Flash) for bulk work (scanning, novelty checks). Reserve expensive models
(Opus, GPT-4o) for high-reasoning tasks (critique, debate judge).

---

## What "Better" Means — How to Evaluate Changes

When proposing an architecture change, measure against these:

| Metric | How to Measure |
|---|---|
| **Idea novelty** | % of ideas that don't closely match any existing product (via idea-reality-mcp) |
| **Idea diversity** | Average pairwise embedding distance across final ideas |
| **Practical feasibility** | Can an MVP be described in concrete terms? |
| **Cost per run** | Total API tokens consumed × price per token |
| **Pipeline duration** | Wall-clock time from input to ranked output |
| **Human preference** | When shown A/B results, which pipeline version does the user prefer? |

If a change improves novelty or diversity without degrading feasibility
or exploding cost, it's probably a good change. Implement it.

---

## Future Expansion — Beyond Business Ideas

The pipeline architecture is domain-agnostic. To expand to new domains:

1. **Add domain-specific scanners** (e.g., academic scanner for research
   ideas, patent scanner for invention ideas, health scanner for wellness ideas)
2. **Swap prompt templates** in src/pipeline/prompts/ — the strategies
   (recombine, analogize, invert, empathize) work across domains
3. **Adjust ranking criteria** — "willingness to pay" becomes "impact
   potential" for social innovation, or "publication potential" for research
4. **Add domain-specific kill tests** — "tarpit check" for business becomes
   "prior art check" for research or "safety check" for health

**Target domains on the roadmap:**
- Product/feature ideas for existing companies
- Research directions for academics
- Creative project ideas (content, art, music, games)
- Social innovation and community improvement
- Personal life optimization (career, learning, habits)
- Technical architecture ideas for engineering teams

The orchestration logic, diversity mechanisms, and evaluation framework
remain the same. Only the domain-specific inputs, prompts, and criteria change.

---

## Standing Request to Claude Code

When working on this project, actively look for ways to:

- **Improve idea quality:** New prompt techniques, better research papers,
  more effective critique methods, smarter ranking
- **Increase diversity:** New generator strategies, better anti-homogenization
  techniques, more creative constraint patterns
- **Reduce cost:** Cheaper models that maintain quality, fewer redundant API
  calls, smarter caching, batched operations
- **Increase speed:** Better parallelization, streaming where possible,
  elimination of unnecessary sequential bottlenecks
- **Find new research:** Papers on creativity, innovation, idea evaluation,
  multi-agent systems that could inform the architecture
- **Discover new tools:** APIs, MCPs, databases that could improve scanner
  coverage or novelty checking
- **Suggest experiments:** "What if we tried X instead of Y? Here's why it
  might produce better ideas..."

This is a research-informed engineering project. The architecture should
get measurably better over time, not just bigger.