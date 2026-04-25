import { describe, it, expect } from 'vitest';
import {
  TECH_SCOUT_ADAPTERS,
  hnAlgoliaAdapter,
  arxivAdapter,
  githubAdapter,
  redditAdapter,
  huggingfaceAdapter,
  cloudflareRadarAdapter,
} from '../../../../../pipeline/scanners/tech-scout/adapters';

describe('TECH_SCOUT_ADAPTERS', () => {
  it('contains exactly 6 adapters in HN → arxiv → GitHub → Reddit → HF → Cloudflare Radar order', () => {
    expect(TECH_SCOUT_ADAPTERS).toHaveLength(6);
    expect(TECH_SCOUT_ADAPTERS[0]).toBe(hnAlgoliaAdapter);
    expect(TECH_SCOUT_ADAPTERS[1]).toBe(arxivAdapter);
    expect(TECH_SCOUT_ADAPTERS[2]).toBe(githubAdapter);
    expect(TECH_SCOUT_ADAPTERS[3]).toBe(redditAdapter);
    expect(TECH_SCOUT_ADAPTERS[4]).toBe(huggingfaceAdapter);
    expect(TECH_SCOUT_ADAPTERS[5]).toBe(cloudflareRadarAdapter);
  });

  it('every adapter has a unique name', () => {
    const names = TECH_SCOUT_ADAPTERS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every adapter name matches its expected value', () => {
    expect(hnAlgoliaAdapter.name).toBe('hn_algolia');
    expect(arxivAdapter.name).toBe('arxiv');
    expect(githubAdapter.name).toBe('github');
    expect(redditAdapter.name).toBe('reddit');
    expect(huggingfaceAdapter.name).toBe('huggingface');
    expect(cloudflareRadarAdapter.name).toBe('cloudflare');
  });

  it('every adapter conforms to the SourceAdapter interface', () => {
    for (const adapter of TECH_SCOUT_ADAPTERS) {
      expect(typeof adapter.name).toBe('string');
      expect(typeof adapter.planQueries).toBe('function');
      expect(typeof adapter.fetch).toBe('function');
      expect(typeof adapter.normalize).toBe('function');
    }
  });
});
