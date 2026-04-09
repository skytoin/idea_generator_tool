import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { deepseek } from '@ai-sdk/deepseek';

/**
 * Available model providers. Pick any model from any provider
 * for any pipeline role. This is a menu, not a prescription.
 */
export const providers = {
  anthropic,
  openai,
  google,
  deepseek,
} as const;

/**
 * Current model assignments per pipeline role.
 * EXPERIMENT FREELY — change these as you test.
 * The only rule: don't hardcode models in step files.
 */
export const models = {
  frame: openai('gpt-4o'),
  scanner: openai('gpt-4o-mini'),
  aggregator: anthropic('claude-sonnet-4-6'),
  generator1: anthropic('claude-sonnet-4-6'),
  generator2: openai('gpt-4o'),
  generator3: google('gemini-2.5-flash'),
  generator4: deepseek('deepseek-chat'),
  critic: anthropic('claude-sonnet-4-6'),
  synthesizer: openai('gpt-4o'),
  ranker: anthropic('claude-sonnet-4-6'),
  embedding: openai.embedding('text-embedding-3-small'),
};