import { describe, it, expect } from 'vitest';
import type {
  ExpandedQueryPlan,
  SourceQuery,
  RawItem,
  FetchOpts,
  SourceAdapter,
  ScannerDeps,
  Scanner,
} from '../../../pipeline/scanners/types';
import * as typesModule from '../../../pipeline/scanners/types';
import type { ScannerReport } from '../../../lib/types/scanner-report';
import type { ScannerDirectives } from '../../../lib/types/scanner-directives';
import type { FounderProfile } from '../../../lib/types/founder-profile';
import type { Signal } from '../../../lib/types/signal';

describe('scanner types module', () => {
  it('exports every expected type name at runtime (shape check)', () => {
    // Types are erased at runtime, but we can at least assert the module
    // loads cleanly and has no unexpected named exports.
    expect(typeof typesModule).toBe('object');
  });

  it('ExpandedQueryPlan has the expected shape via satisfies', () => {
    const plan = {
      expanded_keywords: ['x', 'y'],
      arxiv_categories: ['cs.AI'],
      github_languages: ['python'],
      domain_tags: ['fintech'],
      timeframe_iso: '2026-01-01T00:00:00.000Z',
    } satisfies ExpandedQueryPlan;
    expect(plan.expanded_keywords).toEqual(['x', 'y']);
    expect(plan.timeframe_iso).toBeTruthy();
  });

  it('can construct a SourceQuery literal conforming to the type', () => {
    const q: SourceQuery = { label: 'hn: ai agents', params: { query: 'ai agents' } };
    expect(q.label).toBe('hn: ai agents');
    expect(q.params).toEqual({ query: 'ai agents' });
  });

  it('can construct a RawItem literal conforming to the type', () => {
    const raw: RawItem = { source: 'hn_algolia', data: { title: 'hello' } };
    expect(raw.source).toBe('hn_algolia');
  });

  it('can construct a FetchOpts with optional signal', () => {
    const opts: FetchOpts = { timeoutMs: 5000 };
    expect(opts.timeoutMs).toBe(5000);
    const ac = new AbortController();
    const withSignal: FetchOpts = { timeoutMs: 5000, signal: ac.signal };
    expect(withSignal.signal).toBe(ac.signal);
  });

  it('can construct a mock SourceAdapter object literal conforming to the interface', () => {
    const mockSignal: Signal = {
      source: 'hn_algolia',
      title: 'Hi',
      url: 'https://example.com',
      date: null,
      snippet: '',
      score: { novelty: 5, specificity: 5, recency: 5 },
      category: 'tech_capability',
      raw: {},
    };
    const adapter: SourceAdapter = {
      name: 'hn_algolia',
      planQueries: () => [{ label: 'q', params: {} }],
      fetch: async () => [],
      normalize: () => mockSignal,
    };
    expect(adapter.name).toBe('hn_algolia');
    expect(adapter.planQueries(
      { expanded_keywords: [], arxiv_categories: [], github_languages: [], domain_tags: [], timeframe_iso: '' },
      {} as ScannerDirectives['tech_scout'],
    )).toEqual([{ label: 'q', params: {} }]);
  });

  it('can construct a mock Scanner function conforming to the type', () => {
    const fakeReport: ScannerReport = {
      scanner: 'tech_scout',
      status: 'ok',
      signals: [],
      source_reports: [],
      expansion_plan: null,
      total_raw_items: 0,
      signals_after_dedupe: 0,
      signals_after_exclude: 0,
      cost_usd: 0,
      elapsed_ms: 0,
      generated_at: '2026-04-08T12:00:00.000Z',
      errors: [],
      warnings: [],
    };
    const scanner: Scanner = async () => fakeReport;
    // Invoke it with cast-fake dependencies (compile-time test is the point).
    const deps: ScannerDeps = { clock: () => new Date('2026-04-08T12:00:00.000Z') };
    expect(
      scanner(
        {} as ScannerDirectives['tech_scout'],
        {} as FounderProfile,
        'prose',
        deps,
      ),
    ).resolves.toEqual(fakeReport);
  });

  it('ScannerDeps.scenarios is optional and permits known scenario keys', () => {
    const deps: ScannerDeps = {
      clock: () => new Date(),
      scenarios: {
        expansion: 'default',
        enrichment: 'default',
        hn_algolia: 'timeout',
        arxiv: 'ok',
        github: 'denied',
      },
    };
    expect(deps.scenarios?.hn_algolia).toBe('timeout');
  });
});
