import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  arxivAdapter,
  fetchQueries,
} from '../../../../../pipeline/scanners/tech-scout/adapters/arxiv';
import { setArxivResponse, resetScannerMocks } from '../../../../mocks/scanner-mocks';
import { SAMPLE_ARXIV_XML } from '../../../../mocks/arxiv-fixtures';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** Build a minimum valid ExpandedQueryPlan for arxiv adapter tests. */
function buildPlan(overrides: Partial<ExpandedQueryPlan> = {}): ExpandedQueryPlan {
  return {
    hn_keywords: ['fraud hn'],
    arxiv_keywords: ['fraud', 'anomaly', 'ML'],
    github_keywords: ['fraud github'],
    arxiv_categories: ['cs.LG', 'cs.CR', 'stat.ML'],
    github_languages: ['python'],
    domain_tags: ['fintech'],
    timeframe_iso: '2025-10-11T12:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimum valid tech_scout directive for arxiv adapter tests. */
function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: '',
    target_sources: ['arxiv'],
    timeframe: 'last 6 months',
  };
}

/** No-op sleep used across fetch tests so we don't wait 3+ seconds. */
const noSleep = (): Promise<void> => Promise.resolve();

/**
 * Strip the `+AND+submittedDate:...` suffix from a search_query string
 * so test assertions can focus on the structural clause (cat+ti+abs)
 * without breaking when the date changes. The date range is tested
 * once in its own dedicated assertion.
 */
function stripDateRange(sq: string): string {
  return sq.replace(/\+AND\+submittedDate:%5B[^%]*%5D$/, '');
}

describe('arxivAdapter.planQueries', () => {
  it('produces one query per arxiv_keyword, pairing each with a cycling category', () => {
    const queries = arxivAdapter.planQueries(buildPlan(), buildDirective());
    // 3 arxiv_keywords × 3 categories → 3 queries (keyword-paced, not cross-product).
    expect(queries).toHaveLength(3);
    const labels = queries.map((q) => q.label);
    expect(labels).toEqual([
      'arxiv: cat:cs.LG × "fraud"',
      'arxiv: cat:cs.CR × "anomaly"',
      'arxiv: cat:stat.ML × "ML"',
    ]);
  });

  it('returns an empty array when arxiv_categories is empty (no crash)', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({ arxiv_categories: [] }),
      buildDirective(),
    );
    expect(queries).toEqual([]);
  });

  it('labels follow the "arxiv: cat:<cat> × \\"<keyword>\\"" format', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: ['fraud'],
      }),
      buildDirective(),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.label).toBe('arxiv: cat:cs.LG × "fraud"');
  });

  it('every query has sortBy, sortOrder, max_results, and a search_query param', () => {
    const queries = arxivAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(q.params.sortBy).toBe('submittedDate');
      expect(q.params.sortOrder).toBe('descending');
      expect(q.params.max_results).toBe('20');
      expect(typeof q.params.search_query).toBe('string');
      expect(q.params.search_query as string).toMatch(/^cat:.+\+AND\+/);
    }
  });

  it('search_query for a 1-token keyword uses ti: (title-anchored, no parens)', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: ['fraud'],
      }),
      buildDirective(),
    );
    const sq = stripDateRange(String(queries[0]?.params.search_query));
    expect(sq).toBe('cat:cs.LG+AND+ti:fraud');
  });

  it('search_query for a 2-token keyword uses ti: for first token + abs: for second (title-anchored)', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: ['fraud detection'],
      }),
      buildDirective(),
    );
    const sq = stripDateRange(String(queries[0]?.params.search_query));
    expect(sq).toBe('cat:cs.LG+AND+%28ti:fraud+AND+abs:detection%29');
  });

  it('search_query includes a submittedDate range filter', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: ['fraud'],
      }),
      buildDirective(),
    );
    const sq = String(queries[0]?.params.search_query);
    expect(sq).toContain('submittedDate:%5B');
    expect(sq).toContain('+TO+');
    expect(sq).toContain('%5D');
  });
});

describe('arxivAdapter.fetch', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
  });

  it('parses arxiv XML into 3 RawItems from SAMPLE_ARXIV_XML', async () => {
    setArxivResponse('arxiv-smoke', SAMPLE_ARXIV_XML);
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-smoke');

    const query: SourceQuery = {
      label: 'arxiv: cat:cs.LG × "fraud"',
      params: {
        search_query: `cat:cs.LG+AND+abs:${encodeURIComponent('"fraud"')}`,
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };

    const items = await fetchQueries(
      [query],
      { timeoutMs: 10_000, signal: undefined },
      noSleep,
    );

    expect(items).toHaveLength(3);
    expect(items[0]?.source).toBe('arxiv');
    expect(items.every((i) => i.source === 'arxiv')).toBe(true);
  });

  it('returns an empty array when feed has zero entries', async () => {
    setArxivResponse('arxiv-empty', '<feed xmlns="http://www.w3.org/2005/Atom"/>');
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-empty');

    const query: SourceQuery = {
      label: 'arxiv: cat:cs.LG × "fraud"',
      params: {
        search_query: 'cat:cs.LG+AND+abs:fraud',
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };

    const items = await fetchQueries(
      [query],
      { timeoutMs: 10_000, signal: undefined },
      noSleep,
    );

    expect(items).toEqual([]);
  });

  it('handles single-entry response (object-vs-array fast-xml-parser quirk)', async () => {
    const singleEntryXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2601.99999v1</id>
    <title>Only One Paper</title>
    <summary>Just a single entry.</summary>
    <published>2026-03-14T12:00:00Z</published>
    <updated>2026-03-14T12:00:00Z</updated>
    <category term="cs.LG"/>
  </entry>
</feed>`;
    setArxivResponse('arxiv-single', singleEntryXml);
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-single');

    const query: SourceQuery = {
      label: 'arxiv: cat:cs.LG × "fraud"',
      params: {
        search_query: 'cat:cs.LG+AND+abs:fraud',
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };

    const items = await fetchQueries(
      [query],
      { timeoutMs: 10_000, signal: undefined },
      noSleep,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('arxiv');
  });

  it('sleeps between queries (once, for ≥3000ms) but not before first or after last', async () => {
    setArxivResponse('arxiv-sleep', SAMPLE_ARXIV_XML);
    vi.stubEnv('TECH_SCOUT_SCENARIO_ARXIV', 'arxiv-sleep');

    const sleepSpy = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());

    const queries: SourceQuery[] = [
      {
        label: 'arxiv: cat:cs.LG × "fraud"',
        params: {
          search_query: 'cat:cs.LG+AND+abs:fraud',
          max_results: '20',
          sortBy: 'submittedDate',
          sortOrder: 'descending',
        },
      },
      {
        label: 'arxiv: cat:cs.LG × "anomaly"',
        params: {
          search_query: 'cat:cs.LG+AND+abs:anomaly',
          max_results: '20',
          sortBy: 'submittedDate',
          sortOrder: 'descending',
        },
      },
    ];

    await fetchQueries(queries, { timeoutMs: 10_000, signal: undefined }, sleepSpy);

    expect(sleepSpy).toHaveBeenCalledTimes(1);
    const sleepMs = sleepSpy.mock.calls[0]?.[0] ?? 0;
    expect(sleepMs).toBeGreaterThanOrEqual(3000);
  });

  it('sends a User-Agent header on every arxiv request', async () => {
    // arxiv's API fair-use policy explicitly asks clients to set a
    // User-Agent so they can attribute traffic and rate-limit fairly.
    // Without one, arxiv throttles aggressively (429). Capture the
    // request headers MSW sees and assert a UA is present.
    const capturedHeaders: Array<Record<string, string>> = [];
    const { server } = await import('../../../../mocks/server');
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('http://export.arxiv.org/api/query', ({ request }) => {
        const h: Record<string, string> = {};
        request.headers.forEach((v, k) => {
          h[k.toLowerCase()] = v;
        });
        capturedHeaders.push(h);
        return new HttpResponse(
          '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"/>',
          { headers: { 'content-type': 'application/atom+xml' } },
        );
      }),
    );

    const query: SourceQuery = {
      label: 'arxiv: cat:cs.LG × "fraud"',
      params: {
        search_query: 'cat:cs.LG+AND+abs:fraud',
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    };
    await fetchQueries([query], { timeoutMs: 10_000, signal: undefined }, noSleep);

    expect(capturedHeaders.length).toBeGreaterThan(0);
    const ua = capturedHeaders[0]!['user-agent'];
    expect(ua).toBeDefined();
    // The UA should identify the scanner so arxiv can attribute traffic.
    expect(ua).toContain('idea-generator');
  });

  it('returns partial results when a later query fails (does not discard earlier successes)', async () => {
    // Regression for the 2026-04-15 issue: when arxiv rate-limits
    // query #5 mid-batch, the adapter used to throw and discard
    // queries 1-4's results. New behavior: catch per-query errors,
    // keep successful results, return them with the rest skipped.
    const { server } = await import('../../../../mocks/server');
    const { http, HttpResponse } = await import('msw');
    let callCount = 0;
    server.use(
      http.get('http://export.arxiv.org/api/query', () => {
        callCount += 1;
        // First 2 queries succeed with one entry each, 3rd returns 429.
        if (callCount <= 2) {
          return new HttpResponse(
            `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2601.${callCount}v1</id>
    <title>Paper ${callCount}</title>
    <summary>Abstract ${callCount}</summary>
    <published>2026-03-14T12:00:00Z</published>
    <updated>2026-03-14T12:00:00Z</updated>
    <category term="cs.LG"/>
  </entry>
</feed>`,
            { headers: { 'content-type': 'application/atom+xml' } },
          );
        }
        return new HttpResponse(null, { status: 429 });
      }),
    );

    const queries: SourceQuery[] = [1, 2, 3].map((i) => ({
      label: `arxiv: cat:cs.LG × "q${i}"`,
      params: {
        search_query: `cat:cs.LG+AND+abs:q${i}`,
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    }));

    // Should NOT throw — previously it would have with `arxiv 429`.
    const items = await fetchQueries(
      queries,
      { timeoutMs: 10_000, signal: undefined },
      noSleep,
    );

    // Queries 1 and 2 succeeded → 2 items returned
    // Query 3 hit 429 but the error is swallowed, not thrown
    expect(items).toHaveLength(2);
    expect(callCount).toBe(3); // all 3 queries were attempted
  });

  it('still throws when EVERY query fails (no partial success)', async () => {
    // If 0 queries succeed, the adapter should surface the failure
    // to runOneAdapter so the source is marked denied/failed. Only
    // when AT LEAST ONE query returned items should we swallow later
    // errors to preserve partial success.
    const { server } = await import('../../../../mocks/server');
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('http://export.arxiv.org/api/query', () => {
        return new HttpResponse(null, { status: 429 });
      }),
    );

    const queries: SourceQuery[] = [1, 2].map((i) => ({
      label: `arxiv: cat:cs.LG × "q${i}"`,
      params: {
        search_query: `cat:cs.LG+AND+abs:q${i}`,
        max_results: '20',
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      },
    }));

    await expect(
      fetchQueries(queries, { timeoutMs: 10_000, signal: undefined }, noSleep),
    ).rejects.toThrow(/429/);
  });
});

describe('arxivAdapter.normalize', () => {
  it('converts an arxiv entry into a canonical Signal', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2601.12345v1',
      title: 'Some title',
      summary: '  Long abstract text describing the method.  ',
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }, { '@_term': 'cs.CR' }],
    };
    const raw: RawItem = { source: 'arxiv', data: entry };
    const signal = arxivAdapter.normalize(raw);

    expect(signal.source).toBe('arxiv');
    expect(signal.title).toBe('Some title');
    expect(signal.url).toBe('http://arxiv.org/abs/2601.12345');
    expect(signal.date).toBe('2026-03-14T12:00:00Z');
    expect(signal.snippet).toBe('Long abstract text describing the method.');
    expect(signal.category).toBe('research');
    expect(signal.raw).toBe(entry);
    expect(signal.score).toEqual({
      novelty: 5,
      specificity: 5,
      recency: 5,
      relevance: 5,
    });
  });

  it('strips v<N> version suffix from id URL for dedupe consistency (v2 case)', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2401.12345v2',
      title: 'Versioned paper',
      summary: 'A paper revised several times.',
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.url).toBe('http://arxiv.org/abs/2401.12345');
    expect(signal.url.endsWith('2401.12345')).toBe(true);
  });

  it('truncates abstracts longer than 200 chars and appends an ellipsis', () => {
    const longAbstract = 'a'.repeat(250);
    const entry = {
      id: 'http://arxiv.org/abs/2601.00001v1',
      title: 'Long abstract paper',
      summary: longAbstract,
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.snippet.length).toBe(201);
    expect(signal.snippet.startsWith('a'.repeat(200))).toBe(true);
    expect(signal.snippet.endsWith('…')).toBe(true);
  });

  it('keeps the full abstract (no ellipsis) when shorter than 200 chars', () => {
    const shortAbstract = 'A short abstract.';
    const entry = {
      id: 'http://arxiv.org/abs/2601.00002v1',
      title: 'Short abstract paper',
      summary: shortAbstract,
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.snippet).toBe(shortAbstract);
    expect(signal.snippet.endsWith('…')).toBe(false);
  });

  it('collapses internal whitespace in title', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2601.00003v1',
      title: 'Paper  with\n  extra   spaces',
      summary: 'abstract',
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: [{ '@_term': 'cs.LG' }],
    };
    const signal = arxivAdapter.normalize({ source: 'arxiv', data: entry });
    expect(signal.title).toBe('Paper with extra spaces');
  });
});

/**
 * arXiv search defaults to token-AND. A 4-token keyword like
 * "novel data imputation techniques" forces an almost-impossible
 * contiguous match under the old `abs:"..."` phrase query, so the
 * adapter now decomposes any multi-word keyword into 2 content
 * tokens and AND-joins them as separate `abs:` clauses. These tests
 * pin the rule across diverse founder profiles.
 */
describe('arxivAdapter.planQueries — keyword decomposition (profile-agnostic)', () => {
  /** Return the core search_query (date range stripped) for one keyword. */
  function searchQueryFor(keyword: string): string {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: [keyword],
      }),
      buildDirective(),
    );
    return stripDateRange(String(queries[0]!.params.search_query));
  }

  it('1-token keyword → no parens, single abs: clause', () => {
    expect(searchQueryFor('MCP')).toBe('cat:cs.LG+AND+ti:MCP');
  });

  it('4-token tech keyword → first 2 content tokens in parenthesized AND', () => {
    expect(searchQueryFor('novel data imputation techniques')).toBe(
      'cat:cs.LG+AND+%28ti:novel+AND+abs:data%29',
    );
  });

  it('5-token tech keyword → first 2 content tokens', () => {
    expect(searchQueryFor('recent advancements in supervised learning')).toBe(
      'cat:cs.LG+AND+%28ti:recent+AND+abs:advancements%29',
    );
  });

  it('strips English stopwords before picking content tokens', () => {
    // "social bias mitigation in AI" → first 2 content = "social", "bias"
    expect(searchQueryFor('social bias mitigation in AI')).toBe(
      'cat:cs.LG+AND+%28ti:social+AND+abs:bias%29',
    );
  });

  it('works for a HEALTHCARE profile keyword', () => {
    expect(searchQueryFor('clinical documentation workflow automation')).toBe(
      'cat:cs.LG+AND+%28ti:clinical+AND+abs:documentation%29',
    );
  });

  it('works for a LEGAL profile keyword', () => {
    expect(searchQueryFor('contract review ai assistant')).toBe(
      'cat:cs.LG+AND+%28ti:contract+AND+abs:review%29',
    );
  });

  it('works for a RETAIL profile keyword', () => {
    expect(searchQueryFor('inventory management for small retail shops')).toBe(
      'cat:cs.LG+AND+%28ti:inventory+AND+abs:management%29',
    );
  });

  it('preserves uppercase acronym when it is one of the top 2 tokens', () => {
    expect(searchQueryFor('RAG pipeline retrieval')).toBe(
      'cat:cs.LG+AND+%28ti:RAG+AND+abs:pipeline%29',
    );
  });

  it('drops a keyword that becomes empty after stopword stripping', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: ['for the and', 'real keyword'],
      }),
      buildDirective(),
    );
    expect(queries).toHaveLength(1);
    expect(stripDateRange(String(queries[0]!.params.search_query))).toBe(
      'cat:cs.LG+AND+%28ti:real+AND+abs:keyword%29',
    );
  });

  it('label reflects the decomposed keyword form', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: ['novel data imputation techniques'],
      }),
      buildDirective(),
    );
    expect(queries[0]!.label).toBe('arxiv: cat:cs.LG × "novel data"');
  });
});

/**
 * Sonnet-specific regression: Claude Sonnet 4.6 occasionally emits
 * arxiv_keywords strings that embed arxiv field qualifiers like
 * `cat:cs.LG tabular` (the category code prepended onto the keyword
 * itself). The decomposition helper splits on whitespace and leaves
 * the `cat:cs.LG` token intact, which when fed into the adapter's
 * URL builder produces `abs:cat:cs.LG+AND+abs:tabular` — invalid
 * arxiv query syntax that makes the whole request fail with a non-
 * 2xx status.
 *
 * These tests pin the adapter's defensive sanitization: `cat:X.Y`
 * tokens are dropped entirely (they're filters, not content), and
 * `abs:`, `ti:`, `au:`, etc. field prefixes are stripped from any
 * token while keeping the token content. gpt-4o produces clean
 * keywords so the sanitization is a no-op for it — it only fires
 * on Sonnet's observed failure mode.
 */
describe('arxivAdapter.planQueries — Sonnet field-prefix sanitization', () => {
  /** Get the raw search_query for a plan with one keyword. */
  function searchQueryFor(keyword: string): string | undefined {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: [keyword],
      }),
      buildDirective(),
    );
    return queries[0]
      ? stripDateRange(String(queries[0].params.search_query))
      : undefined;
  }

  it('strips a leading `cat:cs.LG` token from the keyword', () => {
    // Direct reproduction of the 2026-04-15 Sonnet pass-2 failure.
    expect(searchQueryFor('cat:cs.LG tabular')).toBe('cat:cs.LG+AND+ti:tabular');
  });

  it('strips a trailing `cat:cs.IR` token from the keyword', () => {
    expect(searchQueryFor('tabular cat:cs.IR')).toBe('cat:cs.LG+AND+ti:tabular');
  });

  it('strips a `cat:stat.ML` token (lowercase subject + uppercase code)', () => {
    expect(searchQueryFor('cat:stat.ML customer churn')).toBe(
      'cat:cs.LG+AND+%28ti:customer+AND+abs:churn%29',
    );
  });

  it('strips multiple `cat:X.Y` tokens in one keyword', () => {
    expect(searchQueryFor('cat:cs.LG tabular cat:cs.IR search')).toBe(
      'cat:cs.LG+AND+%28ti:tabular+AND+abs:search%29',
    );
  });

  it('drops the whole keyword if it was ONLY a `cat:X.Y` token', () => {
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG'],
        arxiv_keywords: ['cat:cs.LG', 'real keyword'],
      }),
      buildDirective(),
    );
    expect(queries).toHaveLength(1);
    expect(stripDateRange(String(queries[0]!.params.search_query))).toBe(
      'cat:cs.LG+AND+%28ti:real+AND+abs:keyword%29',
    );
  });

  it('strips `abs:` field prefix, keeping the token content', () => {
    expect(searchQueryFor('abs:tabular data')).toBe(
      'cat:cs.LG+AND+%28ti:tabular+AND+abs:data%29',
    );
  });

  it('strips `ti:` field prefix, keeping the token content', () => {
    expect(searchQueryFor('ti:quantum computing')).toBe(
      'cat:cs.LG+AND+%28ti:quantum+AND+abs:computing%29',
    );
  });

  it('is a no-op for a clean gpt-4o-style keyword (regression guard)', () => {
    // Typical gpt-4o output — clean, no arxiv field prefixes.
    // "multi-touch" is split on hyphens: ["multi", "touch"]
    // Combined with "attribution": ["multi", "touch", "attribution"]
    expect(searchQueryFor('multi-touch attribution')).toBe(
      'cat:cs.LG+AND+%28ti:multi+AND+abs:touch+AND+abs:attribution%29',
    );
  });

  it('does not match "abstract" or "categorize" (word containing but not starting with the prefix)', () => {
    // "abstract" contains "abs" but not "abs:" — must not be stripped.
    expect(searchQueryFor('abstract syntax trees')).toBe(
      'cat:cs.LG+AND+%28ti:abstract+AND+abs:syntax%29',
    );
  });

  it('handles the exact 2026-04-15 production failure case', () => {
    // The six malformed keywords from the user's run:
    // `"cat:cs.LG tabular"`, `"cat:cs.IR web"`, etc.
    const queries = arxivAdapter.planQueries(
      buildPlan({
        arxiv_categories: ['cs.LG', 'cs.IR', 'stat.ML'],
        arxiv_keywords: [
          'cat:cs.LG tabular',
          'cat:cs.IR web',
          'cat:stat.ML customer',
          'cat:cs.AI causal',
        ],
      }),
      buildDirective(),
    );
    // All four keywords should produce clean queries, none with
    // the broken `abs:cat:...` pattern.
    for (const q of queries) {
      expect(String(q.params.search_query)).not.toContain('abs:cat:');
      expect(String(q.params.search_query)).not.toContain('abs:cat%3A');
    }
    // First query: cat:cs.LG × "tabular"
    expect(stripDateRange(String(queries[0]!.params.search_query))).toBe(
      'cat:cs.LG+AND+ti:tabular',
    );
  });
});

describe('arxivAdapter interface', () => {
  it('exports name "arxiv"', () => {
    expect(arxivAdapter.name).toBe('arxiv');
  });

  it('conforms to the SourceAdapter interface (type check)', () => {
    const _typed: SourceAdapter = arxivAdapter;
    expect(_typed).toBe(arxivAdapter);
  });
});
