import { describe, it, expect } from 'vitest';
import { TECH_SCOUT_ADAPTERS } from '../../../../../pipeline/scanners/tech-scout/adapters';
import { SIGNAL_SCHEMA } from '../../../../../lib/types/signal';
import type { ExpandedQueryPlan, RawItem } from '../../../../../pipeline/scanners/types';
import type { ScannerDirectives } from '../../../../../lib/types/scanner-directives';

/** A sparse but valid expanded query plan every adapter can plan against. */
const SPARSE_PLAN: ExpandedQueryPlan = {
  hn_keywords: ['fraud detection'],
  arxiv_keywords: ['fraud detection'],
  github_keywords: ['fraud detection'],
  reddit_keywords: ['fraud complaints'],
  huggingface_keywords: ['fraud detection'],
  arxiv_categories: ['cs.LG'],
  github_languages: ['python'],
  reddit_subreddits: ['datascience'],
  domain_tags: ['fintech'],
  timeframe_iso: '2026-01-01T00:00:00.000Z',
};

/** A sparse but valid tech_scout directive every adapter can plan against. */
const SPARSE_DIRECTIVE: ScannerDirectives['tech_scout'] = {
  keywords: ['fraud detection'],
  exclude: [],
  notes: '',
  target_sources: ['hn', 'arxiv', 'github', 'reddit'],
  timeframe: 'last 6 months',
};

/**
 * Per-adapter valid RawItem fixture. Each entry contains a representative
 * record shaped like the upstream API so normalize() produces a Signal
 * that passes SIGNAL_SCHEMA validation. Adding a new adapter requires
 * adding an entry here or the conformance test for it will fail to run.
 */
const RAW_ITEM_FIXTURES: Record<string, RawItem> = {
  hn_algolia: {
    source: 'hn_algolia',
    data: {
      objectID: '12345',
      title: 'Show HN: Conformance fixture',
      url: 'https://example.com/conformance',
      author: 'conformance-bot',
      points: 42,
      num_comments: 7,
      created_at: '2026-03-15T00:00:00.000Z',
      created_at_i: 1742000000,
      _tags: ['story'],
    },
  },
  arxiv: {
    source: 'arxiv',
    data: {
      id: 'http://arxiv.org/abs/2601.00000v1',
      title: 'Conformance Fixture: A Survey',
      summary: 'A short survey used as a valid normalize() input.',
      published: '2026-03-14T12:00:00Z',
      updated: '2026-03-14T12:00:00Z',
      category: { '@_term': 'cs.LG' },
    },
  },
  github: {
    source: 'github',
    data: {
      id: 1,
      name: 'conformance',
      full_name: 'acme/conformance',
      description: 'Conformance fixture repo',
      html_url: 'https://github.com/acme/conformance',
      stargazers_count: 200,
      forks_count: 20,
      language: 'Python',
      topics: ['fraud-detection'],
      pushed_at: '2026-04-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      license: { name: 'MIT' },
    },
  },
  reddit: {
    source: 'reddit',
    data: {
      id: 'abc123',
      title: 'Conformance fixture post',
      url: 'https://www.reddit.com/r/datascience/comments/abc123/conformance_fixture_post/',
      permalink: '/r/datascience/comments/abc123/conformance_fixture_post/',
      created_utc: 1742000000,
      score: 42,
      num_comments: 12,
      author: 'conformance-bot',
      subreddit: 'datascience',
      selftext: 'A short self-post body used as a valid normalize() input.',
      is_self: true,
      over_18: false,
      upvote_ratio: 0.95,
      link_flair_text: null,
    },
  },
  huggingface: {
    source: 'huggingface',
    data: {
      _surface: 'models',
      raw: {
        id: 'conformance/model',
        modelId: 'conformance/model',
        author: 'conformance',
        likes: 100,
        downloads: 5000,
        trendingScore: 50,
        pipeline_tag: 'text-classification',
        library_name: 'transformers',
        tags: ['transformers', 'license:apache-2.0'],
        createdAt: '2026-04-01T00:00:00.000Z',
        lastModified: '2026-04-15T00:00:00.000Z',
        private: false,
        gated: false,
      },
    },
  },
  cloudflare: {
    source: 'cloudflare',
    data: {
      _surface: 'trending_rise',
      raw: {
        domain: 'conformance.test',
        rank: 42,
        pctRankChange: 25,
        categories: [{ id: 1, name: 'Test', superCategoryId: 0 }],
      },
      lastUpdated: '2026-04-25T00:00:00.000Z',
    },
  },
};

describe('adapter interface conformance', () => {
  it('has at least one adapter registered', () => {
    expect(TECH_SCOUT_ADAPTERS.length).toBeGreaterThan(0);
  });

  for (const adapter of TECH_SCOUT_ADAPTERS) {
    describe(`adapter: ${adapter.name}`, () => {
      it('has a non-empty name', () => {
        expect(typeof adapter.name).toBe('string');
        expect(adapter.name.length).toBeGreaterThan(0);
      });

      it('exposes planQueries, fetch, normalize as functions', () => {
        expect(typeof adapter.planQueries).toBe('function');
        expect(typeof adapter.fetch).toBe('function');
        expect(typeof adapter.normalize).toBe('function');
      });

      it('planQueries returns an array for a sparse-but-valid plan', () => {
        const queries = adapter.planQueries(SPARSE_PLAN, SPARSE_DIRECTIVE);
        expect(Array.isArray(queries)).toBe(true);
        // Every query (if any) has a string label and an object params bag.
        for (const q of queries) {
          expect(typeof q.label).toBe('string');
          expect(q.label.length).toBeGreaterThan(0);
          expect(typeof q.params).toBe('object');
          expect(q.params).not.toBeNull();
        }
      });

      it('normalize produces a Signal that passes SIGNAL_SCHEMA.parse', () => {
        const fixture = RAW_ITEM_FIXTURES[adapter.name];
        expect(fixture).toBeDefined();
        if (!fixture) return;
        const signal = adapter.normalize(fixture);
        // If this throws, the adapter's normalize() is non-conformant.
        const parsed = SIGNAL_SCHEMA.safeParse(signal);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.source).toBe(adapter.name);
      });
    });
  }
});
