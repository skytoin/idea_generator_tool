import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  githubAdapter,
  fetchQueries,
  GithubDeniedError,
} from '../../../../../pipeline/scanners/tech-scout/adapters/github';
import { setGithubResponse, resetScannerMocks } from '../../../../mocks/scanner-mocks';
import { server } from '../../../../mocks/server';
import { logger } from '../../../../../lib/utils/logger';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** Build a minimum valid ExpandedQueryPlan for test reuse. */
function buildPlan(overrides: Partial<ExpandedQueryPlan> = {}): ExpandedQueryPlan {
  return {
    hn_keywords: ['fraud hn', 'anomaly hn'],
    arxiv_keywords: ['fraud detection academic'],
    github_keywords: ['fraud detection', 'anomaly detection', 'ML'],
    reddit_keywords: [],
    huggingface_keywords: [],
    arxiv_categories: ['cs.LG'],
    github_languages: ['python', 'rust'],
    reddit_subreddits: [],
    domain_tags: ['fintech'],
    timeframe_iso: '2025-10-11T12:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimum valid tech_scout directive for test reuse. */
function buildDirective(): ScannerDirectives['tech_scout'] {
  return {
    keywords: ['fraud detection'],
    exclude: [],
    notes: '',
    target_sources: ['github'],
    timeframe: 'last 6 months',
  };
}

/** Build a canonical GitHub repository record for normalize() tests. */
function buildRepo(
  overrides: Partial<{
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    topics: string[];
    pushed_at: string;
    created_at: string;
    license: { name: string } | null;
  }> = {},
) {
  return {
    id: 12345,
    name: 'fraud-detective',
    full_name: 'owner/fraud-detective',
    description: 'ML-based fraud detection',
    html_url: 'https://github.com/owner/fraud-detective',
    stargazers_count: 543,
    forks_count: 67,
    language: 'Python',
    topics: ['machine-learning', 'fraud-detection', 'ml', 'python', 'tool', 'x'],
    pushed_at: '2026-04-10T08:30:00Z',
    created_at: '2024-05-01T00:00:00Z',
    license: { name: 'MIT License' },
    ...overrides,
  };
}

describe('githubAdapter.planQueries', () => {
  it('produces one query per github_keyword (capped at MAX_QUERIES)', () => {
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries).toHaveLength(3);
  });

  it('query labels include the keyword without any language suffix', () => {
    // Language filter removed: scanner surfaces inspiration across all
    // languages, not just the founder's primary skill language.
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    const labels = queries.map((q) => q.label);
    expect(labels).toEqual([
      'github: fraud detection',
      'github: anomaly detection',
      'github: ML',
    ]);
  });

  it('produces keyword-only queries regardless of whether github_languages is empty', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_languages: [] }),
      buildDirective(),
    );
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(String(q.params.q)).not.toContain('language:');
    }
  });

  it('query q param is UNQUOTED, has stars and pushed filters, first 3 have consumer topic filter', () => {
    // Default buildPlan has domain_tags: ['fintech'] — NOT a dev-audience tag,
    // so the adapter should use the CONSUMER topic filter (topic:saas etc.).
    const plan = buildPlan();
    const queries = githubAdapter.planQueries(plan, buildDirective());
    const date = plan.timeframe_iso.slice(0, 10);
    for (let i = 0; i < queries.length; i++) {
      const qParam = String(queries[i]!.params.q);
      expect(qParam).not.toMatch(/^"/);
      expect(qParam).not.toContain('"');
      if (i < 3) {
        expect(qParam).toContain('stars:>20');
        expect(qParam).toContain('topic:saas');
      } else {
        expect(qParam).toContain('stars:>50');
        expect(qParam).not.toContain('topic:');
      }
      expect(qParam).toContain(`pushed:>${date}`);
    }
  });

  it('uses DEVTOOL topic filter when domain_tags indicate a developer audience', () => {
    const plan = buildPlan({ domain_tags: ['developer-tools', 'devops'] });
    const queries = githubAdapter.planQueries(plan, buildDirective());
    // First 3 queries should use the dev topic filter, not consumer
    for (let i = 0; i < Math.min(3, queries.length); i++) {
      const qParam = String(queries[i]!.params.q);
      expect(qParam).toContain('topic:cli');
      expect(qParam).toContain('topic:framework');
      expect(qParam).not.toContain('topic:saas');
    }
  });

  it('uses CONSUMER topic filter when domain_tags are non-dev (e.g., ecommerce, martech)', () => {
    const plan = buildPlan({ domain_tags: ['ecommerce', 'martech', 'SaaS'] });
    const queries = githubAdapter.planQueries(plan, buildDirective());
    for (let i = 0; i < Math.min(3, queries.length); i++) {
      const qParam = String(queries[i]!.params.q);
      expect(qParam).toContain('topic:saas');
      expect(qParam).not.toContain('topic:cli');
    }
  });

  it('uses CONSUMER topic filter when domain_tags is empty (safe default)', () => {
    const plan = buildPlan({ domain_tags: [] });
    const queries = githubAdapter.planQueries(plan, buildDirective());
    for (let i = 0; i < Math.min(3, queries.length); i++) {
      const qParam = String(queries[i]!.params.q);
      expect(qParam).toContain('topic:saas');
    }
  });

  it('query q param starts with the raw keyword tokens (no quotes)', () => {
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    const first = String(queries[0]!.params.q);
    expect(first.startsWith('fraud detection ')).toBe(true);
  });

  it('query q param NEVER contains a language: qualifier, even when github_languages is populated', () => {
    // Policy: the adapter IGNORES plan.github_languages entirely.
    // Inspiration should surface across every language on GitHub, so
    // the adapter never auto-restricts the search. This test uses a
    // buildPlan() that DOES populate github_languages — the adapter
    // must drop it anyway.
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(String(q.params.q)).not.toContain('language:');
    }
  });

  it('sets sort=stars, order=desc, per_page=20 on every query', () => {
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(q.params.sort).toBe('stars');
      expect(q.params.order).toBe('desc');
      expect(q.params.per_page).toBe('20');
    }
  });

  it('returns an empty array when github_keywords is empty', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: [] }),
      buildDirective(),
    );
    expect(queries).toEqual([]);
  });

  it('strips any stray quote characters the LLM may have wrapped keywords in', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: ['"python MCP implementation"'] }),
      buildDirective(),
    );
    const qParam = String(queries[0]!.params.q);
    expect(qParam).not.toContain('"');
    // Decomposition takes the first 2 content tokens: "python MCP".
    expect(qParam.startsWith('python MCP ')).toBe(true);
  });

  it('collapses multiple internal whitespace chars in a keyword to a single space', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: ['fraud   detection\t\tsystem'] }),
      buildDirective(),
    );
    const qParam = String(queries[0]!.params.q);
    // Decomposition takes the first 2 content tokens: "fraud detection".
    expect(qParam.startsWith('fraud detection ')).toBe(true);
    expect(qParam).not.toContain('  ');
  });

  it('trims leading/trailing whitespace from a keyword before building q', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: ['   anomaly detection   '] }),
      buildDirective(),
    );
    const qParam = String(queries[0]!.params.q);
    expect(qParam.startsWith('anomaly detection ')).toBe(true);
    expect(qParam).not.toMatch(/^\s/);
  });

  it('drops a keyword that becomes empty after sanitization (e.g. `""`)', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: ['""', '   ', 'real keyword'] }),
      buildDirective(),
    );
    // Only the one surviving keyword should produce a query.
    expect(queries).toHaveLength(1);
    const qParam = String(queries[0]!.params.q);
    expect(qParam.startsWith('real keyword ')).toBe(true);
  });

  it('caps query count at MAX_QUERIES (6) when github_keywords has more', () => {
    const many = Array.from({ length: 10 }, (_, i) => `keyword${i}`);
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: many, github_languages: [] }),
      buildDirective(),
    );
    expect(queries).toHaveLength(6);
    expect(String(queries[0]!.params.q).startsWith('keyword0 ')).toBe(true);
    expect(String(queries[5]!.params.q).startsWith('keyword5 ')).toBe(true);
  });

  it('preserves uppercase acronym tokens verbatim inside a multi-word keyword', () => {
    // The scanner may have re-injected an acronym via enforceAcronymPreservation.
    // The GitHub adapter must NOT lowercase or mangle it.
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: ['MCP server implementation'] }),
      buildDirective(),
    );
    const qParam = String(queries[0]!.params.q);
    expect(qParam).toContain('MCP');
    // Decomposition takes the first 2 content tokens: "MCP server".
    expect(qParam.startsWith('MCP server ')).toBe(true);
  });
});

/**
 * The language filter is NEVER applied automatically. These tests pin
 * that invariant across very different founder profiles — Python,
 * TypeScript, Rust, Go, Java, and the empty/default shape — and prove
 * the adapter ignores plan.github_languages regardless of what the
 * LLM planner decides to put there. The scanner's job is inspiration,
 * not code reuse, so a brilliant TypeScript project is valuable even
 * for a Python-focused founder.
 */
describe('githubAdapter.planQueries — language filter is never auto-applied (profile-agnostic)', () => {
  /** Helper: get the q params for a given plan's github_languages value. */
  function qParamsForLangs(github_languages: string[]): string[] {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_languages }),
      buildDirective(),
    );
    return queries.map((q) => String(q.params.q));
  }

  it('drops language filter for a PYTHON-only founder (plan says ["python"])', () => {
    for (const q of qParamsForLangs(['python'])) {
      expect(q).not.toContain('language:');
    }
  });

  it('drops language filter for a TYPESCRIPT founder (plan says ["typescript"])', () => {
    for (const q of qParamsForLangs(['typescript'])) {
      expect(q).not.toContain('language:');
    }
  });

  it('drops language filter for a RUST founder (plan says ["rust"])', () => {
    for (const q of qParamsForLangs(['rust'])) {
      expect(q).not.toContain('language:');
    }
  });

  it('drops language filter for a GO founder (plan says ["go"])', () => {
    for (const q of qParamsForLangs(['go'])) {
      expect(q).not.toContain('language:');
    }
  });

  it('drops language filter for a JAVA founder (plan says ["java"])', () => {
    for (const q of qParamsForLangs(['java'])) {
      expect(q).not.toContain('language:');
    }
  });

  it('drops language filter for a multi-language founder (plan says ["python","rust","go"])', () => {
    for (const q of qParamsForLangs(['python', 'rust', 'go'])) {
      expect(q).not.toContain('language:');
    }
  });

  it('produces the SAME query strings regardless of github_languages value', () => {
    // Profile-agnostic proof: feed two plans that differ ONLY in
    // github_languages and verify the resulting q strings are identical.
    const plan1 = buildPlan({ github_languages: [] });
    const plan2 = buildPlan({ github_languages: ['python'] });
    const plan3 = buildPlan({ github_languages: ['typescript', 'rust'] });
    const q1 = githubAdapter
      .planQueries(plan1, buildDirective())
      .map((q) => String(q.params.q));
    const q2 = githubAdapter
      .planQueries(plan2, buildDirective())
      .map((q) => String(q.params.q));
    const q3 = githubAdapter
      .planQueries(plan3, buildDirective())
      .map((q) => String(q.params.q));
    expect(q1).toEqual(q2);
    expect(q2).toEqual(q3);
  });

  it('labels never include a language token regardless of github_languages', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({
        github_keywords: ['mcp server'],
        github_languages: ['typescript', 'rust'],
      }),
      buildDirective(),
    );
    expect(queries[0]!.label).toBe('github: mcp server');
    expect(queries[0]!.label).not.toContain('typescript');
    expect(queries[0]!.label).not.toContain('rust');
  });
});

/**
 * GitHub search is strict token-AND. A 4-token keyword like
 * "privacy-preserving data collection library" requires all four
 * tokens to co-occur in a repo's name/description/topics, which
 * almost never happens. The adapter must decompose long keywords to
 * their first 2 content tokens (same rule as HN) before sending
 * them to the API. These tests pin the rule across diverse profiles
 * so it works for any founder, not just the one that found the bug.
 */
describe('githubAdapter.planQueries — keyword decomposition (profile-agnostic)', () => {
  /** Helper: return the `q` param for a plan with one given keyword. */
  function qFor(keyword: string): string {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: [keyword] }),
      buildDirective(),
    );
    return String(queries[0]!.params.q);
  }

  it('passes a 1-token keyword through unchanged (before the filters)', () => {
    expect(qFor('MCP').startsWith('MCP ')).toBe(true);
  });

  it('passes a 2-token keyword through unchanged', () => {
    expect(qFor('fraud detection').startsWith('fraud detection ')).toBe(true);
  });

  it('shortens a 4-token tech keyword to 2 content tokens', () => {
    expect(
      qFor('privacy-preserving data collection library').startsWith(
        'privacy-preserving data ',
      ),
    ).toBe(true);
  });

  it('shortens a 5-token keyword to 2 content tokens', () => {
    expect(qFor('open source ML model management').startsWith('open source ')).toBe(true);
  });

  it('strips English stopwords before picking the first 2 content tokens', () => {
    expect(qFor('Python MCP simulation toolkit').startsWith('Python MCP ')).toBe(true);
  });

  it('works for a HEALTHCARE profile keyword', () => {
    expect(
      qFor('clinical documentation workflow automation').startsWith(
        'clinical documentation ',
      ),
    ).toBe(true);
  });

  it('works for a LEGAL profile keyword', () => {
    expect(qFor('contract review ai assistant').startsWith('contract review ')).toBe(
      true,
    );
  });

  it('works for a RETAIL profile keyword', () => {
    expect(
      qFor('inventory management for small retail shops').startsWith(
        'inventory management ',
      ),
    ).toBe(true);
  });

  it('preserves an uppercase acronym when it is one of the top 2 tokens', () => {
    expect(qFor('RAG pipeline tooling').startsWith('RAG pipeline ')).toBe(true);
  });

  it('drops a keyword that becomes empty after stopword stripping', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: ['for the and', 'real keyword'] }),
      buildDirective(),
    );
    expect(queries).toHaveLength(1);
    expect(String(queries[0]!.params.q).startsWith('real keyword ')).toBe(true);
  });

  it('labels reflect the decomposed query, not the original long keyword', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_keywords: ['privacy-preserving data collection library'] }),
      buildDirective(),
    );
    expect(queries[0]!.label).toBe('github: privacy-preserving data');
  });

  it('applies decomposition independently across a batch of github_keywords', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({
        github_keywords: [
          'privacy-preserving data collection library',
          'Python MCP simulation toolkit',
          'open source ML model management',
          'SaaS analytics dashboard',
          'data validation script',
        ],
      }),
      buildDirective(),
    );
    const qs = queries.map((q) => String(q.params.q));
    expect(qs[0]!.startsWith('privacy-preserving data ')).toBe(true);
    expect(qs[1]!.startsWith('Python MCP ')).toBe(true);
    expect(qs[2]!.startsWith('open source ')).toBe(true);
    expect(qs[3]!.startsWith('SaaS analytics ')).toBe(true);
    expect(qs[4]!.startsWith('data validation ')).toBe(true);
  });
});

describe('githubAdapter.fetch', () => {
  afterEach(() => {
    resetScannerMocks();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends required GitHub auth headers on every request', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test123');
    const capturedHeaders: Record<string, string> = {};
    server.use(
      http.get('https://api.github.com/search/repositories', ({ request }) => {
        request.headers.forEach((val, key) => {
          capturedHeaders[key.toLowerCase()] = val;
        });
        return HttpResponse.json({
          total_count: 0,
          incomplete_results: false,
          items: [],
        });
      }),
    );

    await fetchQueries(
      [
        {
          label: 'github: "x" python',
          params: {
            q: '"x" language:python stars:>50 pushed:>2025-10-11',
            sort: 'stars',
            order: 'desc',
            per_page: '20',
          },
        },
      ],
      { timeoutMs: 10_000 },
    );

    expect(capturedHeaders['authorization']).toBe('Bearer ghp_test123');
    expect(capturedHeaders['accept']).toBe('application/vnd.github+json');
    expect(capturedHeaders['x-github-api-version']).toBe('2022-11-28');
    expect(capturedHeaders['user-agent']).toBe('idea-generator-tech-scout');
  });

  it('returns RawItems wrapping each repo in the items array', async () => {
    const repo1 = buildRepo({ id: 1, full_name: 'a/one' });
    const repo2 = buildRepo({ id: 2, full_name: 'b/two' });
    setGithubResponse('gh-smoke', {
      total_count: 2,
      incomplete_results: false,
      items: [repo1, repo2],
    });
    vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'gh-smoke');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test123');

    const items = await fetchQueries(
      [
        {
          label: 'github: "fraud detection" python',
          params: {
            q: 'fraud detection language:python stars:>50 pushed:>2025-10-11',
            sort: 'stars',
            order: 'desc',
            per_page: '20',
          },
        },
      ],
      { timeoutMs: 10_000 },
    );

    expect(items).toHaveLength(2);
    expect(items[0]?.source).toBe('github');
    expect(items[0]?.data).toEqual(repo1);
    expect(items[1]?.source).toBe('github');
    expect(items[1]?.data).toEqual(repo2);
  });

  it('classifies a 403 response as GithubDeniedError with status 403', async () => {
    setGithubResponse('gh-denied', { __denied: 403 });
    vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'gh-denied');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test123');

    await expect(
      fetchQueries(
        [
          {
            label: 'github: "fraud detection" python',
            params: {
              q: 'fraud detection language:python stars:>50 pushed:>2025-10-11',
              sort: 'stars',
              order: 'desc',
              per_page: '20',
            },
          },
        ],
        { timeoutMs: 10_000 },
      ),
    ).rejects.toMatchObject({
      name: 'GithubDeniedError',
      status: 403,
    });
  });

  it('throws a generic Error (not GithubDeniedError) for a 422 Unprocessable Entity', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test123');
    server.use(
      http.get('https://api.github.com/search/repositories', () =>
        HttpResponse.json({ message: 'Validation Failed' }, { status: 422 }),
      ),
    );

    let caught: unknown;
    try {
      await fetchQueries(
        [
          {
            label: 'github: bad',
            params: {
              q: 'bad',
              sort: 'stars',
              order: 'desc',
              per_page: '20',
            },
          },
        ],
        { timeoutMs: 10_000 },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(GithubDeniedError);
    expect(String(caught)).toContain('422');
  });

  it('logs a warning via pino when the response has incomplete_results: true', async () => {
    setGithubResponse('gh-incomplete', {
      total_count: 1000,
      incomplete_results: true,
      items: [buildRepo()],
    });
    vi.stubEnv('TECH_SCOUT_SCENARIO_GITHUB', 'gh-incomplete');
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test123');

    const warnSpy = vi.spyOn(logger, 'warn');

    const items = await fetchQueries(
      [
        {
          label: 'github: "fraud detection" python',
          params: {
            q: 'fraud detection language:python stars:>50 pushed:>2025-10-11',
            sort: 'stars',
            order: 'desc',
            per_page: '20',
          },
        },
      ],
      { timeoutMs: 10_000 },
    );

    expect(warnSpy).toHaveBeenCalled();
    expect(items).toHaveLength(1);
  });
});

describe('githubAdapter.normalize', () => {
  it('converts a standard repo into a canonical Signal', () => {
    const repo = buildRepo();
    const raw: RawItem = { source: 'github', data: repo };
    const signal = githubAdapter.normalize(raw);

    expect(signal.source).toBe('github');
    expect(signal.title).toBe('owner/fraud-detective');
    expect(signal.url).toBe('https://github.com/owner/fraud-detective');
    expect(signal.date).toBe('2026-04-10T08:30:00Z');
    expect(signal.snippet).toContain('543');
    expect(signal.snippet).toContain('67 forks');
    expect(signal.snippet).toContain('Python');
    expect(signal.snippet).toContain('machine-learning');
    expect(signal.snippet).toContain('ML-based fraud detection');
    expect(signal.category).toBe('adoption');
    expect(signal.raw).toBe(repo);
  });

  it('truncates topics at 5 so only the first 5 appear in the snippet', () => {
    const repo = buildRepo();
    const signal = githubAdapter.normalize({ source: 'github', data: repo });
    expect(signal.snippet).toContain('machine-learning');
    expect(signal.snippet).toContain('fraud-detection');
    expect(signal.snippet).toContain('ml');
    expect(signal.snippet).toContain('python');
    expect(signal.snippet).toContain('tool');
    expect(signal.snippet).not.toContain('topics: ' + repo.topics.join(', '));
    expect(signal.snippet).not.toMatch(/topics:.*\bx\b/);
  });

  it('handles null description without leaking the string "null"', () => {
    const repo = buildRepo({ description: null });
    const signal = githubAdapter.normalize({ source: 'github', data: repo });
    expect(signal.snippet).not.toContain('null');
    expect(typeof signal.snippet).toBe('string');
  });

  it('shows "unknown" when language is null', () => {
    const repo = buildRepo({ language: null });
    const signal = githubAdapter.normalize({ source: 'github', data: repo });
    expect(signal.snippet).toContain('unknown');
  });

  it('omits the topics section from the snippet when topics is empty', () => {
    const repo = buildRepo({ topics: [] });
    const signal = githubAdapter.normalize({ source: 'github', data: repo });
    expect(signal.snippet).not.toContain('topics:');
  });
});

describe('GithubDeniedError class', () => {
  it('has name "GithubDeniedError" and carries status', () => {
    const err = new GithubDeniedError(403);
    expect(err.name).toBe('GithubDeniedError');
    expect(err.status).toBe(403);
  });

  it('is an instance of both GithubDeniedError and Error', () => {
    const err = new GithubDeniedError(403);
    expect(err).toBeInstanceOf(GithubDeniedError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('githubAdapter interface', () => {
  it('exports name "github"', () => {
    expect(githubAdapter.name).toBe('github');
  });

  it('conforms to the SourceAdapter interface (type check)', () => {
    const _typed: SourceAdapter = githubAdapter;
    expect(_typed).toBe(githubAdapter);
  });
});
