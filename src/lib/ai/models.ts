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
 * Resolve the tech_scout model based on the `TECH_SCOUT_MODEL` env
 * variable. Default is OpenAI gpt-4o (the historical baseline). Set
 * `TECH_SCOUT_MODEL=sonnet` to swap in Anthropic Claude Sonnet 4.6
 * for every tech_scout LLM call — that's expansion planning,
 * enrichment, skill-remix, adjacent-worlds, and the pass-2 refine
 * planner. Toggling via env means the test suite (which mocks
 * OpenAI endpoints) stays green without needing to also mock
 * Anthropic, while production runs can flip the switch with a
 * single env change.
 *
 * Why centralize this: the tech_scout role is used by five
 * different modules. Picking the model in one place keeps the
 * model choice consistent across the whole scanner pipeline.
 */
function resolveTechScoutModel() {
  const choice = (process.env.TECH_SCOUT_MODEL ?? '').toLowerCase().trim();
  if (choice === 'opus' || choice === 'claude-opus-4-6') {
    return anthropic('claude-opus-4-6');
  }
  if (choice === 'sonnet' || choice === 'claude-sonnet-4-6') {
    return anthropic('claude-sonnet-4-6');
  }
  return openai('gpt-4o');
}

/**
 * Current model assignments per pipeline role.
 * EXPERIMENT FREELY — change these as you test.
 * The only rule: don't hardcode models in step files.
 */
export const models = {
  frame: openai('gpt-4o'),
  tech_scout: resolveTechScoutModel(),
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
