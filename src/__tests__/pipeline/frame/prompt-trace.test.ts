import { describe, it, expect } from 'vitest';
import { PromptTrace } from '../../../pipeline/frame/prompt-trace';

describe('PromptTrace', () => {
  it('sets consumerName from constructor', () => {
    const trace = new PromptTrace('narrative');
    expect(trace.consumerName).toBe('narrative');
  });

  it('use() returns the value unchanged', () => {
    const trace = new PromptTrace('narrative');
    const input = ['react', 'typescript'];
    const returned = trace.use('skills', input);
    expect(returned).toBe(input);
  });

  it('entries() returns empty array initially', () => {
    const trace = new PromptTrace('tech_scout');
    expect(trace.entries()).toEqual([]);
  });

  it('records multiple distinct field uses', () => {
    const trace = new PromptTrace('narrative');
    trace.use('skills', ['react']);
    trace.use('domain', [{ area: 'fintech', years: 3 }]);
    const entries = trace.entries();
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ field: 'skills', consumer: 'narrative' });
    expect(entries).toContainEqual({ field: 'domain', consumer: 'narrative' });
  });

  it('dedupes repeated use() on the same field', () => {
    const trace = new PromptTrace('narrative');
    trace.use('skills', ['react']);
    trace.use('skills', ['react', 'typescript']);
    const entries = trace.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ field: 'skills', consumer: 'narrative' });
  });

  it('hasUsed returns true after use()', () => {
    const trace = new PromptTrace('narrative');
    trace.use('skills', ['react']);
    expect(trace.hasUsed('skills')).toBe(true);
  });

  it('hasUsed(field, matching consumer) returns true', () => {
    const trace = new PromptTrace('narrative');
    trace.use('skills', ['react']);
    expect(trace.hasUsed('skills', 'narrative')).toBe(true);
  });

  it('hasUsed(field, different consumer) returns false', () => {
    const trace = new PromptTrace('narrative');
    trace.use('skills', ['react']);
    expect(trace.hasUsed('skills', 'tech_scout')).toBe(false);
  });

  it('hasUsed returns false for an unused field', () => {
    const trace = new PromptTrace('narrative');
    trace.use('skills', ['react']);
    expect(trace.hasUsed('nonexistent')).toBe(false);
  });

  it('recording the same field with different values still dedupes', () => {
    const trace = new PromptTrace('tech_scout');
    trace.use('anti_targets', ['crypto']);
    trace.use('anti_targets', ['gambling', 'adult']);
    trace.use('anti_targets', []);
    const entries = trace.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ field: 'anti_targets', consumer: 'tech_scout' });
  });

  it('passes through primitive and nullable values by reference/identity', () => {
    const trace = new PromptTrace('narrative');
    expect(trace.use('trigger', null)).toBeNull();
    expect(trace.use('money_available', 'lt_500')).toBe('lt_500');
    const obj = { value: 42 };
    expect(trace.use('domain', obj)).toBe(obj);
  });
});
