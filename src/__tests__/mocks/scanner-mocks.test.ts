import { describe, it, expect, afterEach } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import {
  setHnResponse,
  getHnResponse,
  setArxivResponse,
  getArxivResponse,
  setGithubResponse,
  getGithubResponse,
  resetScannerMocks,
} from './scanner-mocks';
import { SAMPLE_ARXIV_XML } from './arxiv-fixtures';

describe('scanner-mocks registry', () => {
  afterEach(() => resetScannerMocks());

  it('registers and retrieves HN responses by scenario', () => {
    setHnResponse('s1', { hits: [] });
    expect(getHnResponse('s1')).toEqual({ hits: [] });
  });

  it('registers and retrieves arxiv responses by scenario', () => {
    setArxivResponse('s1', '<feed/>');
    expect(getArxivResponse('s1')).toBe('<feed/>');
  });

  it('registers and retrieves GitHub responses by scenario', () => {
    setGithubResponse('s1', { items: [] });
    expect(getGithubResponse('s1')).toEqual({ items: [] });
  });

  it('stores a GitHub denied marker without transformation', () => {
    setGithubResponse('denied1', { __denied: 403 });
    expect(getGithubResponse('denied1')).toEqual({ __denied: 403 });
  });

  it('resetScannerMocks clears all three registries', () => {
    setHnResponse('x', { hits: [] });
    setArxivResponse('x', '<feed/>');
    setGithubResponse('x', { items: [] });
    resetScannerMocks();
    expect(getHnResponse('x')).toBeUndefined();
    expect(getArxivResponse('x')).toBeUndefined();
    expect(getGithubResponse('x')).toBeUndefined();
  });
});

describe('arxiv fixture', () => {
  it('parses SAMPLE_ARXIV_XML without throwing and contains at least 3 entries', () => {
    const parser = new XMLParser();
    const parsed = parser.parse(SAMPLE_ARXIV_XML);
    const entries = parsed?.feed?.entry;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(3);
  });
});

describe('MSW scanner handlers', () => {
  afterEach(() => resetScannerMocks());

  it('returns the registered body for HN scenario', async () => {
    setHnResponse('hn-test1', {
      hits: [{ objectID: '1', title: 'test' }],
      nbHits: 1,
    });
    const res = await fetch('https://hn.algolia.com/api/v1/search?query=x', {
      headers: { 'x-test-scenario': 'hn-test1' },
    });
    const body = (await res.json()) as {
      hits: Array<{ objectID: string; title: string }>;
    };
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]!.title).toBe('test');
  });

  it('returns a fallback empty HN payload when no scenario matches', async () => {
    const res = await fetch('https://hn.algolia.com/api/v1/search?query=x');
    const body = (await res.json()) as { hits: unknown[] };
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits).toHaveLength(0);
  });

  it('returns the registered XML for arxiv scenario', async () => {
    setArxivResponse('arxiv-test1', SAMPLE_ARXIV_XML);
    const res = await fetch(
      'http://export.arxiv.org/api/query?search_query=fraud',
      { headers: { 'x-test-scenario': 'arxiv-test1' } },
    );
    const xml = await res.text();
    expect(xml).toContain('<feed');
    expect(xml).toContain('Adversarial Fraud Detection');
    expect(res.headers.get('content-type')).toContain('atom+xml');
  });

  it('returns a fallback empty arxiv feed when no scenario matches', async () => {
    const res = await fetch(
      'http://export.arxiv.org/api/query?search_query=anything',
    );
    const xml = await res.text();
    expect(xml).toContain('<feed');
  });

  it('returns the registered body for GitHub scenario', async () => {
    setGithubResponse('gh-test1', {
      total_count: 1,
      incomplete_results: false,
      items: [{ id: 1, name: 'repo' }],
    });
    const res = await fetch(
      'https://api.github.com/search/repositories?q=fraud',
      { headers: { 'x-test-scenario': 'gh-test1' } },
    );
    const body = (await res.json()) as {
      items: Array<{ id: number; name: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.name).toBe('repo');
  });

  it('returns a denied HTTP status when GitHub scenario uses __denied', async () => {
    setGithubResponse('gh-denied', { __denied: 403 });
    const res = await fetch(
      'https://api.github.com/search/repositories?q=fraud',
      { headers: { 'x-test-scenario': 'gh-denied' } },
    );
    expect(res.status).toBe(403);
  });

  it('returns a fallback empty GitHub payload when no scenario matches', async () => {
    const res = await fetch(
      'https://api.github.com/search/repositories?q=anything',
    );
    const body = (await res.json()) as {
      total_count: number;
      items: unknown[];
    };
    expect(body.total_count).toBe(0);
    expect(Array.isArray(body.items)).toBe(true);
  });
});
