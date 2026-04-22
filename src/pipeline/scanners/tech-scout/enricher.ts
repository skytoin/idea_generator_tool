import { generateObject } from 'ai';
import { models } from '../../../lib/ai/models';
import type { Signal } from '../../../lib/types/signal';
import { estimateCost } from '../../frame/estimate-cost';
import {
  ENRICHMENT_RESPONSE_SCHEMA,
  ENRICHMENT_WIRE_SCHEMA,
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
  type EnrichmentResponse,
} from '../../prompts/tech-scout-enrichment';

export type EnricherOptions = {
  /** Scenario marker routed through the MSW OpenAI mock. */
  scenario?: string;
  /** Cap on number of signals sent to the LLM (default 40). */
  topN?: number;
  /** Brief founder goal summary for relevance scoring. */
  founderContext?: string;
};

export type EnricherResult = {
  signals: Signal[];
  cost_usd: number;
  warnings: string[];
};

const FALLBACK_SCORE = { novelty: 5, specificity: 5, recency: 5, relevance: 5 } as const;
const DEFAULT_TOP_N = 40;

/**
 * Run one LLM pass to clean and score the top-N raw signals. Returns
 * enriched signals plus any warnings. Preserves url/source/date/raw on
 * every signal; only title/snippet/score/category are replaced by LLM
 * output. On LLM error, returns all inputs unchanged with fallback
 * scores and a warning. Never throws.
 */
export async function enrichSignals(
  input: Signal[],
  options: EnricherOptions = {},
): Promise<EnricherResult> {
  if (input.length === 0) return { signals: [], cost_usd: 0, warnings: [] };
  const topN = options.topN ?? DEFAULT_TOP_N;
  const subset = input.slice(0, topN);

  try {
    const { object, usage } = await generateObject({
      model: models.tech_scout,
      schema: ENRICHMENT_WIRE_SCHEMA,
      system: buildEnrichmentSystemPrompt(options.scenario, options.founderContext),
      prompt: buildEnrichmentUserPrompt(subset.map(toEnrichmentInput)),
    });
    // Post-parse strict validation. The wire schema is loose so that
    // Anthropic's tool_use (which rejects `minimum`/`maximum` on
    // integers and has narrower constraint support than OpenAI's
    // response_format) accepts it. After the model returns, we
    // re-validate against ENRICHMENT_RESPONSE_SCHEMA to re-apply
    // score bounds, integer index, and non-empty title — the same
    // strictness the old code had at the generateObject boundary.
    const validated = ENRICHMENT_RESPONSE_SCHEMA.safeParse(object);
    if (!validated.success) {
      return buildFallback(
        subset,
        new Error(`enrichment_schema_invalid: ${validated.error.message}`),
      );
    }
    return mergeEnrichment(subset, validated.data, usage);
  } catch (e) {
    return buildFallback(subset, e);
  }
}

/** Project a Signal into the minimal EnrichmentInput shape. */
function toEnrichmentInput(s: Signal): {
  title: string;
  snippet: string;
  source: string;
  date: string | null;
  url: string;
} {
  return {
    title: s.title,
    snippet: s.snippet,
    source: s.source,
    date: s.date,
    url: s.url,
  };
}

/** Build an EnricherResult that preserves originals with fallback scores. */
function buildFallback(subset: Signal[], e: unknown): EnricherResult {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    signals: subset.map((s) => ({ ...s, score: { ...FALLBACK_SCORE } })),
    cost_usd: 0,
    warnings: [`enrichment_failed: ${msg}`],
  };
}

/**
 * Merge LLM enrichment output with the original signals by index.
 * Any input index missing from the LLM response keeps its original
 * title/snippet and receives a fallback score plus a warning.
 */
function mergeEnrichment(
  subset: Signal[],
  response: EnrichmentResponse,
  usage: { inputTokens?: number; outputTokens?: number },
): EnricherResult {
  const byIndex = new Map(response.signals.map((s) => [s.index, s]));
  const warnings: string[] = [];
  const enriched = subset.map((orig, i) => mergeOne(orig, byIndex.get(i), i, warnings));
  return { signals: enriched, cost_usd: estimateCost(usage), warnings };
}

/**
 * Merge one enriched entry onto the original signal, or return the
 * original with a fallback score if the entry is missing. Mutates the
 * warnings array when an index is absent.
 */
function mergeOne(
  orig: Signal,
  enriched: EnrichmentResponse['signals'][number] | undefined,
  index: number,
  warnings: string[],
): Signal {
  if (!enriched) {
    warnings.push(`enrichment missing for index ${index}`);
    return { ...orig, score: { ...FALLBACK_SCORE } };
  }
  return {
    ...orig,
    title: enriched.title,
    snippet: enriched.snippet,
    score: enriched.score,
    category: enriched.category,
  };
}
