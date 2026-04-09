import { describe, it, expect } from 'vitest';
import { estimateCost, GPT_4O_COST_PER_1K } from '../../../pipeline/frame/estimate-cost';

describe('estimateCost', () => {
  it('returns 0 for zero tokens', () => {
    expect(estimateCost({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('returns 0 for undefined token counts', () => {
    expect(estimateCost({})).toBe(0);
  });

  it('computes 1000 input + 500 output correctly', () => {
    const cost = estimateCost({ inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('handles undefined input with defined output', () => {
    const cost = estimateCost({ outputTokens: 1000 });
    expect(cost).toBeCloseTo(0.01, 6);
  });

  it('handles undefined output with defined input', () => {
    const cost = estimateCost({ inputTokens: 1000 });
    expect(cost).toBeCloseTo(0.0025, 6);
  });

  it('exports the reference pricing constant', () => {
    expect(GPT_4O_COST_PER_1K.input).toBe(0.0025);
    expect(GPT_4O_COST_PER_1K.output).toBe(0.01);
  });
});
