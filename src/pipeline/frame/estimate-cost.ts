/**
 * Approximate gpt-4o token pricing per 1k tokens as of 2024. Used by the
 * frame step to attach a cost estimate to every LLM call result.
 */
export const GPT_4O_COST_PER_1K = { input: 0.0025, output: 0.01 } as const;

/**
 * Convert a LanguageModelUsage-like object into a USD cost estimate using the
 * gpt-4o reference pricing. Missing token counts are treated as zero.
 */
export function estimateCost(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}): number {
  const i = usage.inputTokens ?? 0;
  const o = usage.outputTokens ?? 0;
  return (i * GPT_4O_COST_PER_1K.input + o * GPT_4O_COST_PER_1K.output) / 1000;
}
