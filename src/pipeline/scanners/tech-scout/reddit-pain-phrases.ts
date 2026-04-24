/**
 * Profile-agnostic pain-detection phrases for the Reddit adapter.
 *
 * These phrases work across every founder profile because the phrase
 * carries the PAIN signal (someone articulating a problem) while the
 * subreddit carries the DOMAIN context. A nurse founder searching
 * "I would pay" in r/nursing finds nurse-specific pain; a DevOps
 * founder searching the same phrase in r/devops finds DevOps pain.
 *
 * The phrases are ordered by empirical signal strength per the
 * research doc in docs/tech-scout-sources.md — willingness-to-pay
 * phrases first, then unmet-need, then competitor-complaint, then
 * switching signals, then orphaned-user signals. Downstream pairs
 * these phrases with subreddits in `adapters/reddit.ts:planQueries`.
 *
 * Adding a phrase = one more signal angle per Reddit run. Removing a
 * phrase doesn't hurt existing behavior because the adapter only
 * consumes `selectPainPhrases(N)` rather than the whole list directly.
 */
export const REDDIT_PAIN_PHRASES: readonly string[] = [
  'I would pay',
  'wish there was',
  'frustrated with',
  'looking for alternative',
  'why is there no',
  'built a tool',
  'switched from',
  'shut down',
] as const;

/**
 * OR-expansion variants per base pain phrase. Reddit search is literal:
 * `"I would pay"` (quoted) matches only that exact sequence. Real users
 * say "I'd pay", "would pay for", "would gladly pay" — all invisible to
 * the base phrase alone. These variants are OR'd into the pain query so
 * one logical signal ("willingness to pay") captures all the natural
 * ways humans phrase it.
 *
 * Keep lists short (≤4 per base). Longer OR lists bloat the URL and
 * dilute per-phrase precision without much recall gain. Variants are
 * intentionally close paraphrases, not synonyms — "I would buy" is NOT
 * a variant of "I would pay" because the pain semantics differ.
 *
 * Any base phrase not listed here falls back to just itself — callers
 * should use `expandPainPhrase(base)` rather than reaching into this
 * record directly so the fallback is consistent.
 */
export const REDDIT_PAIN_PHRASE_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  'I would pay': ['I would pay', 'would pay for', "I'd pay", 'would gladly pay'],
  'wish there was': ['wish there was', 'wish there were', 'wish someone would'],
  'frustrated with': ['frustrated with', 'fed up with', 'tired of'],
  'looking for alternative': [
    'looking for alternative',
    'alternative to',
    'replacement for',
  ],
  'why is there no': ['why is there no', 'why does no one', 'why has nobody'],
  'built a tool': ['built a tool', 'made a tool', 'built this tool'],
  'switched from': ['switched from', 'moving away from', 'ditched it for'],
  'shut down': ['shut down', 'shutting down', 'killed off'],
} as const;

/**
 * Return the OR-expansion variants for a base pain phrase, or just
 * [base] if no variants are registered. Centralizes the lookup so
 * the adapter never has to guard against missing keys.
 */
export function expandPainPhrase(base: string): readonly string[] {
  const variants = REDDIT_PAIN_PHRASE_VARIANTS[base];
  return variants ?? [base];
}

/**
 * Deterministic non-crypto hash for rotation seeds. djb2 — fast,
 * well-distributed for short ASCII strings, and produces a stable
 * number across Node and browser runtimes (no crypto dep). We cap
 * at 32-bit to avoid BigInt overhead and take |x| so the result is
 * always nonneg for modulo arithmetic.
 */
function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33) ^ seed.charCodeAt(i);
  }
  return Math.abs(h | 0);
}

/**
 * Pick `count` pain phrases from REDDIT_PAIN_PHRASES. When `seed` is
 * omitted or empty, returns the first `count` phrases verbatim (the
 * simplest deterministic behavior — same every run). When `seed` is
 * supplied, rotates the list so different seeds surface different
 * phrases, enabling per-founder or per-run variety without losing
 * determinism within a single seed.
 *
 * `count` is clamped to [0, REDDIT_PAIN_PHRASES.length], so a caller
 * asking for 20 phrases gets 8 and a caller asking for -1 gets 0.
 * Returns a fresh array so callers can mutate without leaking into
 * the shared constant. The order within the returned array is stable
 * for a given (count, seed) pair.
 */
export function selectPainPhrases(count: number, seed?: string): string[] {
  if (count <= 0) return [];
  const capped = Math.min(count, REDDIT_PAIN_PHRASES.length);
  if (seed === undefined || seed.length === 0) {
    return REDDIT_PAIN_PHRASES.slice(0, capped);
  }
  const offset = hashSeed(seed) % REDDIT_PAIN_PHRASES.length;
  const rotated = [
    ...REDDIT_PAIN_PHRASES.slice(offset),
    ...REDDIT_PAIN_PHRASES.slice(0, offset),
  ];
  return rotated.slice(0, capped);
}
