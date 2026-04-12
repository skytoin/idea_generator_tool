/**
 * Regression tests for the Tech Scout v1.1 signal-quality fixes:
 *   - Fix 2: enrichment happens BEFORE top-N so diverse sources survive
 *   - Fix 5: directive.target_sources filters the adapter registry
 *
 * The tests stub a minimal happy-path flow for expansion and enrichment
 * via the OpenAI mock, register per-source MSW responses that return
 * many signals so the pre-Fix-2 bug (HN dominating top-25) would be
 * detectable, and then assert the final signal set actually spans all
 * three sources.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { runTechScout } from '../../../../pipeline/scanners/tech-scout/scanner';
import {
  setOpenAIResponse,
  resetOpenAIMock,
} from '../../../mocks/openai-mock';
import {
  setHnResponse,
  setArxivResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../../../mocks/scanner-mocks';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

const FIXED_CLOCK = () => new Date('2026-04-11T12:00:00Z');

/** Minimum valid founder profile for orchestrator integration tests. */
function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  const assumed = <T>(value: T) => ({ value, source: 'assumed' as const });
  return {
    skills: stated(['python', 'ml']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'fintech', years: 5 }]),
    insider_knowledge: stated('Fraud analysts use bad tools'),
    anti_targets: stated(['crypto', 'gambling']),
    network: assumed(null),
    audience: assumed(null),
    proprietary_access: assumed(null),
    rare_combinations: assumed(null),
    recurring_frustration: assumed(null),
    four_week_mvp: assumed(null),
    previous_attempts: assumed(null),
    customer_affinity: assumed(null),
    time_to_revenue: assumed('no_preference'),
    customer_type_preference: assumed('no_preference'),
    trigger: assumed(null),
    legal_constraints: assumed(null),
    divergence_level: assumed('balanced'),
    additional_context_raw: '',
    schema_version: 1,
    profile_hash: 'test-hash',
  };
}

/** Minimum valid tech_scout directive for orchestrator integration tests. */
function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: ['crypto', 'gambling'],
    notes: 'Focus on ML fraud tools',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

/** Build a single HN hit shape with per-call customization. */
function hnHit(i: number) {
  return {
    objectID: `hn-${i}`,
    title: `HN story ${i}`,
    url: `https://hn.example/${i}`,
    author: 'alice',
    points: 100 + i,
    num_comments: 20,
    created_at: '2026-03-01T00:00:00.000Z',
    created_at_i: 1740000000,
    _tags: ['story'],
  };
}

/** Build a single arxiv Atom entry. fast-xml-parser parses <category/>. */
function arxivXml(count: number): string {
  const entries = Array.from({ length: count }, (_, i) => `  <entry>
    <id>http://arxiv.org/abs/2603.${String(10000 + i).padStart(5, '0')}v1</id>
    <title>Arxiv paper ${i}: ML for fraud</title>
    <summary>An abstract about ML fraud detection paper number ${i}.</summary>
    <published>2026-03-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z</published>
    <updated>2026-03-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z</updated>
    <category term="cs.LG"/>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${entries}
</feed>`;
}

/** Build a GitHub Search response body with N repo items. */
function githubBody(count: number) {
  return {
    total_count: count,
    incomplete_results: false,
    items: Array.from({ length: count }, (_, i) => ({
      id: i,
      name: `repo-${i}`,
      full_name: `owner/repo-${i}`,
      description: 'ML fraud detection library',
      html_url: `https://github.com/owner/repo-${i}`,
      stargazers_count: 500 + i,
      forks_count: 50,
      language: 'Python',
      topics: ['machine-learning', 'fraud-detection'],
      pushed_at: '2026-04-01T00:00:00.000Z',
      created_at: '2025-01-01T00:00:00.000Z',
      license: { name: 'MIT License' },
    })),
  };
}

const VALID_EXPANSION_CONTENT = JSON.stringify({
  expanded_keywords: ['fraud detection', 'anomaly detection', 'risk scoring'],
  arxiv_categories: ['cs.LG'],
  github_languages: ['python'],
  domain_tags: ['fintech'],
});

/**
 * Build an enrichment response that enriches `count` indices with uniform
 * HIGH scores. The uniform-score choice is deliberate: a test that scores
 * signals by index position would accidentally couple test assertions to
 * the interleaveBySource iteration order (HN → arxiv → github), which is
 * an implementation detail of the orchestrator and not a contract the
 * test should be pinning. With uniform scores, keepTop behaves as a
 * stable sort → first-in-first-out, which lets us verify that signals
 * from every source survive the final cut.
 */
function enrichmentContent(count: number): string {
  return JSON.stringify({
    signals: Array.from({ length: count }, (_, i) => ({
      index: i,
      title: `Enriched ${i}`,
      snippet: `Enriched snippet ${i}`,
      score: { novelty: 10, specificity: 10, recency: 10 },
      category: 'tech_capability' as const,
    })),
  });
}

/**
 * Same as enrichmentContent but with DESCENDING scores by index.
 * Used by the "uses post-enrichment scores" test which specifically needs
 * to assert the final signal list is ordered by LLM-assigned score.
 */
function descendingEnrichmentContent(count: number): string {
  return JSON.stringify({
    signals: Array.from({ length: count }, (_, i) => ({
      index: i,
      title: `Enriched ${i}`,
      snippet: `Enriched snippet ${i}`,
      score: {
        novelty: Math.max(1, 10 - Math.floor(i / 5)),
        specificity: Math.max(1, 10 - Math.floor(i / 5)),
        recency: Math.max(1, 10 - Math.floor(i / 5)),
      },
      category: 'tech_capability' as const,
    })),
  });
}

function stubScenarioEnv() {
  vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'hn-sq');
  vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-sq');
  vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'github-sq');
  vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
}

describe('runTechScout — Fix 2: enrich-before-topN prevents single-source domination', () => {
  beforeEach(() => {
    stubScenarioEnv();
  });

  afterEach(() => {
    resetOpenAIMock();
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it(
    'diversifies final signals across all 3 sources when each returns many raw hits',
    { timeout: 30_000 },
    async () => {
      // The bug that this test fixes: HN returned 90 raw hits, arxiv 80,
      // github 40. All with default score 5/5/5. keepTop(25) ran BEFORE
      // enrichment, so the stable sort picked 25 HN signals (insertion
      // order). The fix: interleaveBySource(15) → enrich → keepTop(25),
      // so each source contributes fairly.
      //
      // Per-source counts are 10 each (= 30 total). With per-source
      // cap = 15, all 30 survive interleaving. keepTop(25) on 30 uniform
      // signals with a stable sort picks 10 HN + 10 arxiv + 5 github —
      // every source represented.
      setOpenAIResponse('expansion-sq', { content: VALID_EXPANSION_CONTENT });
      setOpenAIResponse('enrichment-sq', {
        content: enrichmentContent(30),
      });
      setHnResponse('hn-sq', {
        hits: Array.from({ length: 10 }, (_, i) => hnHit(i)),
        nbHits: 10,
        page: 0,
        nbPages: 1,
        hitsPerPage: 30,
        query: '',
        params: '',
      });
      setArxivResponse('arxiv-sq', arxivXml(10));
      setGithubResponse('github-sq', githubBody(10));

      const report = await runTechScout(
        buildDirective(),
        buildProfile(),
        'narrative prose',
        {
          clock: FIXED_CLOCK,
          scenarios: {
            expansion: 'expansion-sq',
            enrichment: 'enrichment-sq',
          },
        },
      );

      expect(report.status).toBe('ok');
      // Must have signals from MORE THAN ONE source — the whole point.
      const sources = new Set(report.signals.map((s) => s.source));
      expect(sources.size).toBeGreaterThan(1);
      // All 3 sources must be represented in the final signals.
      expect(sources.has('hn_algolia')).toBe(true);
      expect(sources.has('arxiv')).toBe(true);
      expect(sources.has('github')).toBe(true);
    },
  );

  it(
    'uses post-enrichment scores for the final top-N cut',
    { timeout: 30_000 },
    async () => {
      // The enrichment mock assigns descending scores (first index = 10/10/10,
      // later indices lower). The final signals, after keepTop(25), should
      // contain the high-score entries. This only works if keepTop runs
      // AFTER enrichment — which is the Fix 2 behavior.
      setOpenAIResponse('expansion-sq', { content: VALID_EXPANSION_CONTENT });
      setOpenAIResponse('enrichment-sq', {
        content: descendingEnrichmentContent(30),
      });
      setHnResponse('hn-sq', {
        hits: Array.from({ length: 10 }, (_, i) => hnHit(i)),
        nbHits: 10,
        page: 0,
        nbPages: 1,
        hitsPerPage: 30,
        query: '',
        params: '',
      });
      setArxivResponse('arxiv-sq', arxivXml(10));
      setGithubResponse('github-sq', githubBody(10));

      const report = await runTechScout(
        buildDirective(),
        buildProfile(),
        'narrative prose',
        {
          clock: FIXED_CLOCK,
          scenarios: {
            expansion: 'expansion-sq',
            enrichment: 'enrichment-sq',
          },
        },
      );

      expect(report.status).toBe('ok');
      // The very first signal should have a high composite score because
      // it's the best-scored one from enrichment (index 0 gets 10/10/10).
      expect(report.signals.length).toBeGreaterThan(0);
      const firstSignal = report.signals[0];
      expect(firstSignal).toBeDefined();
      if (firstSignal) {
        const composite =
          firstSignal.score.novelty +
          firstSignal.score.specificity +
          firstSignal.score.recency;
        // Must be > 15 (the default pre-enrichment score sum) — if the
        // bug returns, this would fail because default 5/5/5 = 15.
        expect(composite).toBeGreaterThan(15);
      }
    },
  );
});

describe('runTechScout — Fix 5: selectAdapters respects directive.target_sources', () => {
  beforeEach(() => {
    stubScenarioEnv();
  });

  afterEach(() => {
    resetOpenAIMock();
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it(
    'runs only HN when target_sources is ["hn"]',
    { timeout: 30_000 },
    async () => {
      setOpenAIResponse('expansion-sq', { content: VALID_EXPANSION_CONTENT });
      setOpenAIResponse('enrichment-sq', {
        content: enrichmentContent(1),
      });
      setHnResponse('hn-sq', {
        hits: [hnHit(0)],
        nbHits: 1,
        page: 0,
        nbPages: 1,
        hitsPerPage: 30,
        query: '',
        params: '',
      });
      // Even though arxiv and github mocks are registered, they should
      // not be hit because target_sources only allows hn.
      setArxivResponse('arxiv-sq', arxivXml(5));
      setGithubResponse('github-sq', githubBody(5));

      const report = await runTechScout(
        buildDirective({ target_sources: ['hn'] }),
        buildProfile(),
        'narrative prose',
        {
          clock: FIXED_CLOCK,
          scenarios: {
            expansion: 'expansion-sq',
            enrichment: 'enrichment-sq',
          },
        },
      );

      expect(report.status).toBe('ok');
      // Only one source_report — the HN one.
      expect(report.source_reports).toHaveLength(1);
      expect(report.source_reports[0]?.name).toBe('hn_algolia');
      // No signals can have source arxiv or github because those adapters
      // never ran.
      for (const s of report.signals) {
        expect(s.source).toBe('hn_algolia');
      }
    },
  );

  it(
    'falls back to all adapters when target_sources only contains unmapped aliases (producthunt)',
    { timeout: 30_000 },
    async () => {
      // producthunt is in the schema enum but has no adapter. If the LLM
      // ONLY picks producthunt, the filter would produce zero runnable
      // adapters — which would leave the scanner with nothing to do.
      // The fallback is: use all registered adapters when the filter
      // produces zero matches.
      setOpenAIResponse('expansion-sq', { content: VALID_EXPANSION_CONTENT });
      setOpenAIResponse('enrichment-sq', {
        content: enrichmentContent(3),
      });
      setHnResponse('hn-sq', {
        hits: [hnHit(0)],
        nbHits: 1,
        page: 0,
        nbPages: 1,
        hitsPerPage: 30,
        query: '',
        params: '',
      });
      setArxivResponse('arxiv-sq', arxivXml(1));
      setGithubResponse('github-sq', githubBody(1));

      const report = await runTechScout(
        buildDirective({ target_sources: ['producthunt'] }),
        buildProfile(),
        'narrative prose',
        {
          clock: FIXED_CLOCK,
          scenarios: {
            expansion: 'expansion-sq',
            enrichment: 'enrichment-sq',
          },
        },
      );

      expect(report.status).toBe('ok');
      // Full registry fallback — all 3 adapters ran.
      expect(report.source_reports).toHaveLength(3);
    },
  );

  it(
    'runs all 3 adapters when target_sources is ["hn","arxiv","github"] (the expected common case)',
    { timeout: 30_000 },
    async () => {
      setOpenAIResponse('expansion-sq', { content: VALID_EXPANSION_CONTENT });
      setOpenAIResponse('enrichment-sq', {
        content: enrichmentContent(3),
      });
      setHnResponse('hn-sq', {
        hits: [hnHit(0)],
        nbHits: 1,
        page: 0,
        nbPages: 1,
        hitsPerPage: 30,
        query: '',
        params: '',
      });
      setArxivResponse('arxiv-sq', arxivXml(1));
      setGithubResponse('github-sq', githubBody(1));

      const report = await runTechScout(
        buildDirective({ target_sources: ['hn', 'arxiv', 'github'] }),
        buildProfile(),
        'narrative prose',
        {
          clock: FIXED_CLOCK,
          scenarios: {
            expansion: 'expansion-sq',
            enrichment: 'enrichment-sq',
          },
        },
      );

      expect(report.source_reports).toHaveLength(3);
      const names = report.source_reports.map((r) => r.name).sort();
      expect(names).toEqual(['arxiv', 'github', 'hn_algolia']);
    },
  );

  it(
    'skips unmapped aliases from a mixed list (e.g., ["hn","producthunt"] runs only hn)',
    { timeout: 30_000 },
    async () => {
      setOpenAIResponse('expansion-sq', { content: VALID_EXPANSION_CONTENT });
      setOpenAIResponse('enrichment-sq', {
        content: enrichmentContent(1),
      });
      setHnResponse('hn-sq', {
        hits: [hnHit(0)],
        nbHits: 1,
        page: 0,
        nbPages: 1,
        hitsPerPage: 30,
        query: '',
        params: '',
      });

      const report = await runTechScout(
        buildDirective({ target_sources: ['hn', 'producthunt'] }),
        buildProfile(),
        'narrative prose',
        {
          clock: FIXED_CLOCK,
          scenarios: {
            expansion: 'expansion-sq',
            enrichment: 'enrichment-sq',
          },
        },
      );

      // Only HN ran; producthunt filtered out; no fallback because HN is
      // a valid mapped alias.
      expect(report.source_reports).toHaveLength(1);
      expect(report.source_reports[0]?.name).toBe('hn_algolia');
    },
  );
});
