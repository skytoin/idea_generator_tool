import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  githubAdapter,
  fetchQueries,
  GithubDeniedError,
} from '../../../../../pipeline/scanners/tech-scout/adapters/github';
import {
  setGithubResponse,
  resetScannerMocks,
} from '../../../../mocks/scanner-mocks';
import { server } from '../../../../mocks/server';
import { logger } from '../../../../../lib/utils/logger';
import type {
  SourceAdapter,
  ExpandedQueryPlan,
  RawItem,
} from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** Build a minimum valid ExpandedQueryPlan for test reuse. */
function buildPlan(
  overrides: Partial<ExpandedQueryPlan> = {},
): ExpandedQueryPlan {
  return {
    expanded_keywords: ['fraud detection', 'anomaly detection', 'ML'],
    arxiv_categories: ['cs.LG'],
    github_languages: ['python', 'rust'],
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
  it('generates top 2 keywords x top 2 languages = 4 queries when languages provided', () => {
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    expect(queries).toHaveLength(4);
  });

  it('query labels use the "github: <keyword> <language>" form when language present', () => {
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    const labels = queries.map((q) => q.label);
    expect(labels).toContain('github: "fraud detection" python');
    expect(labels).toContain('github: "fraud detection" rust');
    expect(labels).toContain('github: "anomaly detection" python');
    expect(labels).toContain('github: "anomaly detection" rust');
  });

  it('query labels drop the language suffix when no language is given', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_languages: [] }),
      buildDirective(),
    );
    expect(queries.map((q) => q.label)).toEqual([
      'github: "fraud detection"',
      'github: "anomaly detection"',
      'github: "ML"',
    ]);
  });

  it('falls back to top 3 keyword-only queries when no github_languages are set', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ github_languages: [] }),
      buildDirective(),
    );
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(String(q.params.q)).not.toContain('language:');
    }
  });

  it('query q param contains the quoted keyword and stars:>50 and pushed:>YYYY-MM-DD', () => {
    const plan = buildPlan();
    const queries = githubAdapter.planQueries(plan, buildDirective());
    const date = plan.timeframe_iso.slice(0, 10);
    for (const q of queries) {
      const qParam = String(q.params.q);
      expect(qParam).toMatch(/^".+"/);
      expect(qParam).toContain('stars:>50');
      expect(qParam).toContain(`pushed:>${date}`);
    }
  });

  it('query q param contains language:<lang> qualifier when language applies', () => {
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    const pythonQueries = queries.filter((q) =>
      String(q.params.q).includes('language:python'),
    );
    const rustQueries = queries.filter((q) =>
      String(q.params.q).includes('language:rust'),
    );
    expect(pythonQueries).toHaveLength(2);
    expect(rustQueries).toHaveLength(2);
  });

  it('sets sort=stars, order=desc, per_page=20 on every query', () => {
    const queries = githubAdapter.planQueries(buildPlan(), buildDirective());
    for (const q of queries) {
      expect(q.params.sort).toBe('stars');
      expect(q.params.order).toBe('desc');
      expect(q.params.per_page).toBe('20');
    }
  });

  it('returns an empty array when expanded_keywords is empty', () => {
    const queries = githubAdapter.planQueries(
      buildPlan({ expanded_keywords: [] }),
      buildDirective(),
    );
    expect(queries).toEqual([]);
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
            q: '"fraud detection" language:python stars:>50 pushed:>2025-10-11',
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
              q: '"fraud detection" language:python stars:>50 pushed:>2025-10-11',
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
            q: '"fraud detection" language:python stars:>50 pushed:>2025-10-11',
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
