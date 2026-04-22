/**
 * Shared keyword-decomposition utility for source adapters.
 *
 * All three current sources (Hacker News Algolia, GitHub Search, arXiv)
 * default to strict token-AND search. A 4-token phrase like
 * "privacy preserving data collection library" requires every token to
 * co-occur in a candidate document, which almost never happens — HN
 * story titles are short, GitHub repo names and descriptions rarely
 * carry four related words, and arXiv abstracts do not coincidentally
 * use four exact terms from a founder profile. The observed symptom
 * is that compound-phrase keywords starve every source for results.
 *
 * The fix is to decompose long multi-word keywords into a small set
 * of content tokens before handing them to the source. Two tokens is
 * the empirical sweet spot across diverse founder profiles: narrow
 * enough to filter noise, loose enough to match real content. The
 * rule is PROFILE-AGNOSTIC — it reads only the keyword string and
 * knows nothing about skills, domain, or audience, so it works the
 * same way for a nurse, a lawyer, a data scientist, or any other
 * founder shape.
 */

/**
 * Small, profile-agnostic English stopword set. These words carry no
 * search signal (search engines like HN/GitHub/arXiv tokenize and
 * ignore them anyway, but filtering client-side lets the adapter
 * keep the "first 2 content tokens" rule deterministic). Kept
 * deliberately small — a larger list starts eating real content.
 */
export const SEARCH_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/**
 * Default number of content tokens to keep after stopword stripping.
 * Two is the empirical sweet spot; see module header.
 */
export const DEFAULT_MAX_CONTENT_TOKENS = 2;

/**
 * Decompose any multi-word keyword into a short token list. Strips
 * English stopwords and collapses whitespace, then keeps the first
 * `maxTokens` content tokens. A keyword that resolves to an empty
 * list (all stopwords, all whitespace, or simply empty) returns an
 * empty array so the caller can drop it from the query batch.
 *
 * Casing is preserved so acronyms (MCP, CLI, RAG) survive without
 * mangling. The `maxTokens` default is 2; callers can override for
 * sources that tolerate longer phrases.
 */
export function decomposeKeywordToTokens(
  keyword: string,
  maxTokens: number = DEFAULT_MAX_CONTENT_TOKENS,
): string[] {
  const tokens = keyword
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !SEARCH_STOPWORDS.has(t.toLowerCase()));
  if (tokens.length === 0) return [];
  return tokens.slice(0, maxTokens);
}

/**
 * Convenience wrapper: decompose a keyword and join the resulting
 * tokens with a single space. Returns an empty string when the
 * keyword contains no content tokens so callers can detect and
 * skip it. Equivalent to HN's historical `toHnSearchQuery` shape,
 * reused across adapters.
 */
export function decomposeKeywordToString(
  keyword: string,
  maxTokens: number = DEFAULT_MAX_CONTENT_TOKENS,
): string {
  return decomposeKeywordToTokens(keyword, maxTokens).join(' ');
}
