import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { runTechScout } from '../../../../pipeline/scanners/tech-scout/scanner';
import { setOpenAIResponse, resetOpenAIMock } from '../../../mocks/openai-mock';
import {
  setHnResponse,
  setArxivResponse,
  setGithubResponse,
  resetScannerMocks,
} from '../../../mocks/scanner-mocks';
import { server } from '../../../mocks/server';
import type { FounderProfile } from '../../../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../../../lib/types/scanner-directives';

/**
 * Scanner-level integration tests that exercise all four post-run bug
 * fixes end-to-end:
 *  1. GitHub query syntax — unquoted keywords, no `%22` in q param
 *  2. Timeframe filter — stale signals dropped pre-enrichment
 *  3. Acronym preservation — directive acronym re-injected into expansion plan
 *  4. Quality floor — low-recency/relevance signals dropped post-enrichment
 *
 * This file uses v2-schema mocks (per-source keyword lists + 4-field
 * score) on purpose so it does not collide with the pre-existing
 * scanner.test.ts fixtures, which still reference the v1 schema.
 */

/** Inline minimum-valid founder profile for the integration tests. */
function buildProfile(): FounderProfile {
  const stated = <T>(value: T) => ({ value, source: 'stated' as const });
  const assumed = <T>(value: T) => ({ value, source: 'assumed' as const });
  return {
    skills: stated(['Python', 'ML']),
    time_per_week: stated('20'),
    money_available: stated('lt_5k'),
    ambition: stated('supplemental'),
    domain: stated([{ area: 'fintech', years: 6 }]),
    insider_knowledge: stated('MCP server tooling gaps'),
    anti_targets: stated([]),
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
    profile_hash: 'bug-fix-integration',
  };
}

/** Build a tech_scout directive with a literal MCP acronym in keywords. */
function buildDirective(
  overrides: Partial<ScannerDirectives['tech_scout']> = {},
): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['MCP', 'data collection'],
    exclude: [],
    notes: 'integration test directive',
    target_sources: ['hn', 'arxiv', 'github'],
    timeframe: 'last 6 months',
    ...overrides,
  };
}

/**
 * Build a v2 expansion JSON matching EXPANSION_RESPONSE_SCHEMA. Each
 * per-source keyword list starts with 4 items so `.min(4)` passes. The
 * caller can omit MCP on purpose to drive the acronym-preservation test.
 */
function buildExpansionJson(
  overrides: Partial<{
    hn_keywords: string[];
    arxiv_keywords: string[];
    github_keywords: string[];
    reddit_keywords: string[];
    arxiv_categories: string[];
    github_languages: string[];
    reddit_subreddits: string[];
  }> = {},
): string {
  return JSON.stringify({
    hn_keywords: overrides.hn_keywords ?? [
      'data collection saas',
      'consumer ml tools',
      'indie product launches',
      'personal analytics',
    ],
    arxiv_keywords: overrides.arxiv_keywords ?? [
      'automated feature engineering',
      'multi-source data fusion',
      'few-shot adaptation',
      'knowledge transfer',
    ],
    github_keywords: overrides.github_keywords ?? [
      'web scraping pipeline',
      'data aggregation framework',
      'feature store',
      'python tool',
    ],
    reddit_keywords: overrides.reddit_keywords ?? [
      'data collection frustration',
      'analytics tool alternatives',
      'indie founder complaints',
    ],
    arxiv_categories: overrides.arxiv_categories ?? ['cs.LG'],
    github_languages: overrides.github_languages ?? ['python'],
    reddit_subreddits: overrides.reddit_subreddits ?? ['datascience', 'SaaS'],
    domain_tags: ['fintech'],
  });
}

/**
 * Build a v2 enrichment JSON with a `relevance` field in each score.
 * `indexCount` entries are produced, each with a configurable recency
 * and relevance so tests can drive the quality floor branch.
 */
function buildEnrichmentJson(
  indexCount: number,
  opts: { recency?: number; relevance?: number } = {},
): string {
  const recency = opts.recency ?? 8;
  const relevance = opts.relevance ?? 8;
  return JSON.stringify({
    signals: Array.from({ length: indexCount }, (_, i) => ({
      index: i,
      title: `Enriched ${i}`,
      snippet: `Snippet ${i}`,
      score: { novelty: 7, specificity: 7, recency, relevance },
      category: 'tech_capability',
    })),
  });
}

/** Build a fake HN hit record for test payloads. */
function buildHnHit(overrides: {
  objectID: string;
  title: string;
  url?: string;
  created_at: string;
}) {
  return {
    objectID: overrides.objectID,
    title: overrides.title,
    url: overrides.url ?? `https://example.com/hn-${overrides.objectID}`,
    author: 'alice',
    points: 100,
    num_comments: 20,
    created_at: overrides.created_at,
    created_at_i: Math.floor(new Date(overrides.created_at).getTime() / 1000),
    _tags: ['story'],
  };
}

/** Build a fake GitHub repo record. */
function buildGhRepo(overrides: {
  id: number;
  full_name: string;
  html_url?: string;
  pushed_at: string;
}) {
  return {
    id: overrides.id,
    name: overrides.full_name.split('/')[1],
    full_name: overrides.full_name,
    description: 'test repo',
    html_url: overrides.html_url ?? `https://github.com/${overrides.full_name}`,
    stargazers_count: 500,
    forks_count: 40,
    language: 'Python',
    topics: ['data', 'python'],
    pushed_at: overrides.pushed_at,
    created_at: '2024-05-01T00:00:00Z',
    license: { name: 'MIT' },
  };
}

/** Stub all three source scenario env vars and GITHUB_TOKEN. */
function stubEnvFor3Scanners(): void {
  vi.stubEnv('TECH_SCOUT_SCENARIO_HN', 'bf-hn');
  vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'bf-arxiv');
  vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'bf-github');
  vi.stubEnv('GITHUB_TOKEN', 'ghp_bug_fix_test');
}

const FIXED_CLOCK = () => new Date('2026-04-12T12:00:00Z');

/** Shared afterEach teardown. */
function teardown(): void {
  resetOpenAIMock();
  resetScannerMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
}

describe('runTechScout — bug 2 wiring: timeframe filter drops stale signals', () => {
  afterEach(teardown);

  it('drops 2023-dated HN signals before enrichment, keeps 2026-dated', async () => {
    setOpenAIResponse('bf-expansion', { content: buildExpansionJson() });
    setOpenAIResponse('bf-enrich', { content: buildEnrichmentJson(10) });
    setHnResponse('bf-hn', {
      hits: [
        buildHnHit({
          objectID: 'fresh1',
          title: 'Fresh HN item 1',
          created_at: '2026-02-01T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'fresh2',
          title: 'Fresh HN item 2',
          created_at: '2026-03-15T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'stale1',
          title: 'Stale HN item 1',
          created_at: '2023-11-19T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'stale2',
          title: 'Stale HN item 2',
          created_at: '2023-06-12T00:00:00.000Z',
        }),
      ],
    });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('bf-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: FIXED_CLOCK,
      scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
    });

    expect(report.status).toBe('ok');
    const titles = report.signals.map((s) => s.title);
    // The enricher rewrites titles ("Enriched N") but preserves URL.
    // Stale hits have objectIDs stale1/stale2 → URL ends in /hn-stale*.
    const urls = report.signals.map((s) => s.url);
    expect(urls.every((u) => !u.includes('stale'))).toBe(true);
    expect(titles.length).toBeGreaterThan(0);
  }, 20_000);
});

describe('runTechScout — bug 4 wiring: quality floor drops low-relevance/recency', () => {
  afterEach(teardown);

  it('drops enriched signals below relevance=5 and records a warning', async () => {
    setOpenAIResponse('bf-expansion', { content: buildExpansionJson() });
    // Enricher scores EVERY signal with relevance=2 (below floor=5)
    setOpenAIResponse('bf-enrich', {
      content: buildEnrichmentJson(3, { relevance: 2, recency: 8 }),
    });
    setHnResponse('bf-hn', {
      hits: [
        buildHnHit({
          objectID: 'a',
          title: 'a',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'b',
          title: 'b',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'c',
          title: 'c',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
      ],
    });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('bf-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: FIXED_CLOCK,
      scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
    });

    // All signals failed the quality floor → empty output + warning
    expect(report.signals).toHaveLength(0);
    expect(report.warnings.some((w) => w.startsWith('quality_floor:'))).toBe(true);
  }, 20_000);

  it('drops enriched signals below recency=4 but keeps the high-recency ones', async () => {
    setOpenAIResponse('bf-expansion', { content: buildExpansionJson() });
    // Trickier: enricher emits 3 signals with varying recency.
    setOpenAIResponse('bf-enrich', {
      content: JSON.stringify({
        signals: [
          {
            index: 0,
            title: 'ok',
            snippet: 's',
            score: { novelty: 8, specificity: 8, recency: 9, relevance: 8 },
            category: 'tech_capability',
          },
          {
            index: 1,
            title: 'drop',
            snippet: 's',
            score: { novelty: 9, specificity: 9, recency: 2, relevance: 8 },
            category: 'tech_capability',
          },
          {
            index: 2,
            title: 'drop2',
            snippet: 's',
            score: { novelty: 9, specificity: 9, recency: 8, relevance: 3 },
            category: 'tech_capability',
          },
        ],
      }),
    });
    setHnResponse('bf-hn', {
      hits: [
        buildHnHit({
          objectID: 'keep',
          title: 'keep',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'drop-recency',
          title: 'drop-recency',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'drop-relevance',
          title: 'drop-relevance',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
      ],
    });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('bf-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: FIXED_CLOCK,
      scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
    });

    // Only the high-recency, high-relevance signal should survive.
    expect(report.signals).toHaveLength(1);
    const titles = report.signals.map((s) => s.title);
    expect(titles).not.toContain('drop');
    expect(titles).not.toContain('drop2');
    expect(report.warnings.some((w) => w.includes('dropped 2 signals'))).toBe(true);
  }, 20_000);
});

describe('runTechScout — bug 3 wiring: acronym preservation injects MCP into the plan', () => {
  afterEach(teardown);

  it('appends MCP to the expansion plan when the LLM response omits it', async () => {
    // Mock response deliberately OMITS any reference to MCP. The
    // planner's enforceAcronymPreservation guard must inject it back.
    setOpenAIResponse('bf-expansion', {
      content: buildExpansionJson({
        hn_keywords: ['saas launches', 'consumer tools', 'product hunts', 'analytics'],
        arxiv_keywords: [
          'feature engineering',
          'data fusion',
          'transfer learning',
          'retrieval',
        ],
        github_keywords: ['web scraping', 'aggregation', 'feature store', 'cli wrapper'],
      }),
    });
    setOpenAIResponse('bf-enrich', { content: buildEnrichmentJson(1) });
    setHnResponse('bf-hn', {
      hits: [
        buildHnHit({
          objectID: '1',
          title: 'Fresh',
          created_at: '2026-03-15T00:00:00.000Z',
        }),
      ],
    });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('bf-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective({ keywords: ['MCP'] }),
      buildProfile(),
      'narrative',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
      },
    );

    const plan = report.expansion_plan as Record<string, unknown> | null;
    expect(plan).not.toBeNull();
    if (!plan) return;
    const hn = plan.hn_keywords as string[];
    const arxiv = plan.arxiv_keywords as string[];
    const github = plan.github_keywords as string[];
    // MCP should appear in ALL three lists after enforcement.
    expect(hn).toContain('MCP');
    expect(arxiv).toContain('MCP');
    expect(github).toContain('MCP');
  }, 20_000);

  it('does NOT re-inject MCP when the LLM response already preserved it', async () => {
    setOpenAIResponse('bf-expansion', {
      content: buildExpansionJson({
        hn_keywords: [
          'MCP server launches',
          'consumer tools',
          'product hunts',
          'analytics',
        ],
      }),
    });
    setOpenAIResponse('bf-enrich', { content: buildEnrichmentJson(1) });
    setHnResponse('bf-hn', {
      hits: [
        buildHnHit({
          objectID: '1',
          title: 'Fresh',
          created_at: '2026-03-15T00:00:00.000Z',
        }),
      ],
    });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    setGithubResponse('bf-github', {
      total_count: 0,
      incomplete_results: false,
      items: [],
    });
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective({ keywords: ['MCP'] }),
      buildProfile(),
      'narrative',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
      },
    );

    const plan = report.expansion_plan as Record<string, unknown> | null;
    if (!plan) throw new Error('plan must be non-null');
    const arxiv = plan.arxiv_keywords as string[];
    const github = plan.github_keywords as string[];
    // arxiv/github did NOT contain MCP in the mock response AND the
    // haystack check found MCP preserved in hn → no injection anywhere.
    expect(arxiv).not.toContain('MCP');
    expect(github).not.toContain('MCP');
  }, 20_000);
});

describe('runTechScout — bug 1 wiring: GitHub queries sent unquoted', () => {
  afterEach(teardown);

  it('the q= param never contains %22 (encoded double quote)', async () => {
    const capturedUrls: string[] = [];
    // Override the github handler to capture request URLs for assertion.
    server.use(
      http.get('https://api.github.com/search/repositories', ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({
          total_count: 0,
          incomplete_results: false,
          items: [],
        });
      }),
    );
    setOpenAIResponse('bf-expansion', {
      content: buildExpansionJson({
        github_keywords: [
          'mcp server implementation',
          'data aggregation framework',
          'feature store python',
          'web scraping pipeline',
        ],
      }),
    });
    setOpenAIResponse('bf-enrich', { content: buildEnrichmentJson(0) });
    setHnResponse('bf-hn', { hits: [] });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    stubEnvFor3Scanners();

    await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: FIXED_CLOCK,
      scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
    });

    expect(capturedUrls.length).toBeGreaterThan(0);
    for (const url of capturedUrls) {
      expect(url).not.toContain('%22');
    }
  }, 20_000);

  it('the q= param contains stars:>50 and a pushed:> date filter', async () => {
    const capturedUrls: string[] = [];
    server.use(
      http.get('https://api.github.com/search/repositories', ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({
          total_count: 0,
          incomplete_results: false,
          items: [],
        });
      }),
    );
    setOpenAIResponse('bf-expansion', { content: buildExpansionJson() });
    setOpenAIResponse('bf-enrich', { content: buildEnrichmentJson(0) });
    setHnResponse('bf-hn', { hits: [] });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    stubEnvFor3Scanners();

    await runTechScout(buildDirective(), buildProfile(), 'narrative', {
      clock: FIXED_CLOCK,
      scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
    });

    expect(capturedUrls.length).toBeGreaterThan(0);
    for (const url of capturedUrls) {
      // URL-decoded assertions for readability
      const decoded = decodeURIComponent(url);
      // First PRODUCT_QUERY_COUNT queries use stars:>20, rest use stars:>50
      expect(decoded).toMatch(/stars:>(20|50)/);
      expect(decoded).toMatch(/pushed:>\d{4}-\d{2}-\d{2}/);
    }
  }, 20_000);
});

describe('runTechScout — all 4 fixes fire together', () => {
  afterEach(teardown);

  it('combined: stale+low-score dropped, MCP preserved, github unquoted', async () => {
    const capturedGhUrls: string[] = [];
    server.use(
      http.get('https://api.github.com/search/repositories', ({ request }) => {
        capturedGhUrls.push(request.url);
        return HttpResponse.json({
          total_count: 0,
          incomplete_results: false,
          items: [],
        });
      }),
    );
    setOpenAIResponse('bf-expansion', {
      content: buildExpansionJson({
        // MCP deliberately absent from every list — enforcer must inject.
        hn_keywords: ['saas launches', 'consumer tools', 'analytics', 'indie dev'],
        arxiv_keywords: ['feature engineering', 'data fusion', 'transfer', 'retrieval'],
        github_keywords: ['scraping', 'aggregation', 'feature store', 'cli wrapper'],
      }),
    });
    // Enrich with mixed quality: index 0 clean, 1 low-recency, 2 low-relevance.
    setOpenAIResponse('bf-enrich', {
      content: JSON.stringify({
        signals: [
          {
            index: 0,
            title: 'clean',
            snippet: 's',
            score: { novelty: 8, specificity: 8, recency: 9, relevance: 8 },
            category: 'tech_capability',
          },
          {
            index: 1,
            title: 'low-rec',
            snippet: 's',
            score: { novelty: 9, specificity: 9, recency: 2, relevance: 9 },
            category: 'tech_capability',
          },
        ],
      }),
    });
    setHnResponse('bf-hn', {
      hits: [
        buildHnHit({
          objectID: 'fresh-a',
          title: 'Fresh',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'fresh-b',
          title: 'Fresh 2',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
        buildHnHit({
          objectID: 'stale-a',
          title: 'stale',
          created_at: '2023-06-01T00:00:00.000Z',
        }),
      ],
    });
    setArxivResponse('bf-arxiv', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    stubEnvFor3Scanners();

    const report = await runTechScout(
      buildDirective({ keywords: ['MCP'] }),
      buildProfile(),
      'narrative',
      {
        clock: FIXED_CLOCK,
        scenarios: { expansion: 'bf-expansion', enrichment: 'bf-enrich' },
      },
    );

    // Bug 2: stale dropped — no URL containing "stale"
    expect(report.signals.every((s) => !s.url.includes('stale'))).toBe(true);
    // Bug 4: only the clean (index 0) signal survives
    expect(report.signals).toHaveLength(1);
    expect(report.signals[0]!.title).toBe('clean');
    expect(report.warnings.some((w) => w.startsWith('quality_floor:'))).toBe(true);
    // Bug 3: MCP injected into the expansion plan
    const plan = report.expansion_plan as Record<string, unknown> | null;
    expect(plan).not.toBeNull();
    if (plan) {
      const hn = plan.hn_keywords as string[];
      expect(hn).toContain('MCP');
    }
    // Bug 1: no quoted GitHub queries
    expect(capturedGhUrls.length).toBeGreaterThan(0);
    for (const url of capturedGhUrls) {
      expect(url).not.toContain('%22');
    }
  }, 20_000);
});
