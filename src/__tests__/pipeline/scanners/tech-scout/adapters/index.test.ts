import { describe, it, expect } from 'vitest';
import {
  TECH_SCOUT_ADAPTERS,
  hnAlgoliaAdapter,
  arxivAdapter,
  githubAdapter,
} from '../../../../../pipeline/scanners/tech-scout/adapters';

describe('TECH_SCOUT_ADAPTERS', () => {
  it('contains exactly 3 adapters in HN → arxiv → GitHub order', () => {
    expect(TECH_SCOUT_ADAPTERS).toHaveLength(3);
    expect(TECH_SCOUT_ADAPTERS[0]).toBe(hnAlgoliaAdapter);
    expect(TECH_SCOUT_ADAPTERS[1]).toBe(arxivAdapter);
    expect(TECH_SCOUT_ADAPTERS[2]).toBe(githubAdapter);
  });

  it('every adapter has a unique name', () => {
    const names = TECH_SCOUT_ADAPTERS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every adapter name matches its expected value', () => {
    expect(hnAlgoliaAdapter.name).toBe('hn_algolia');
    expect(arxivAdapter.name).toBe('arxiv');
    expect(githubAdapter.name).toBe('github');
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
