/**
 * In-memory registries of scenario-keyed scanner-source responses for
 * tests. Tests register a body via setXResponse before making an HTTP
 * call with an `x-test-scenario` header; the corresponding MSW handler
 * in ./handlers.ts reads the header, looks up the body, and returns
 * it. Each scanner source (HN Algolia, arxiv, GitHub) has its own
 * registry because their content shapes differ.
 */

type HnBody = unknown;
type ArxivBody = string;
type GhBody = unknown | { __denied: number };
type RedditBody = unknown | { __denied: number };
type HuggingfaceBody = unknown | { __denied: number };
type CloudflareBody = unknown | { __denied: number };

const hnRegistry = new Map<string, HnBody>();
const arxivRegistry = new Map<string, ArxivBody>();
const ghRegistry = new Map<string, GhBody>();
const redditRegistry = new Map<string, RedditBody>();
const hfRegistry = new Map<string, HuggingfaceBody>();
const cfRegistry = new Map<string, CloudflareBody>();

/** Register a scenario-keyed HN Algolia JSON response for the MSW handler. */
export function setHnResponse(scenario: string, body: HnBody): void {
  hnRegistry.set(scenario, body);
}

/** Look up a registered HN response by scenario name. */
export function getHnResponse(scenario: string): HnBody | undefined {
  return hnRegistry.get(scenario);
}

/** Register a scenario-keyed arxiv Atom XML string response. */
export function setArxivResponse(scenario: string, xml: ArxivBody): void {
  arxivRegistry.set(scenario, xml);
}

/** Look up a registered arxiv response by scenario name. */
export function getArxivResponse(scenario: string): ArxivBody | undefined {
  return arxivRegistry.get(scenario);
}

/**
 * Register a scenario-keyed GitHub Search response. Pass
 * `{ __denied: 403 }` (or any HTTP code) to simulate a rate-limit
 * response instead of a successful body.
 */
export function setGithubResponse(scenario: string, body: GhBody): void {
  ghRegistry.set(scenario, body);
}

/** Look up a registered GitHub response by scenario name. */
export function getGithubResponse(scenario: string): GhBody | undefined {
  return ghRegistry.get(scenario);
}

/**
 * Register a scenario-keyed Reddit Listing response. Pass
 * `{ __denied: 429 }` (or any HTTP code ≥ 400) to simulate a
 * rate-limit or forbidden response instead of a successful body.
 */
export function setRedditResponse(scenario: string, body: RedditBody): void {
  redditRegistry.set(scenario, body);
}

/** Look up a registered Reddit response by scenario name. */
export function getRedditResponse(scenario: string): RedditBody | undefined {
  return redditRegistry.get(scenario);
}

/**
 * Register a scenario-keyed Hugging Face listing response. The same
 * registry serves all three HF surfaces (models, spaces, daily_papers)
 * because the MSW handler routes purely by `x-test-scenario` header
 * — the body is whatever shape the test wants. Pass `{ __denied: 429 }`
 * (or any HTTP code ≥ 400) to simulate a rate-limit / forbidden
 * response instead of a successful body.
 */
export function setHuggingfaceResponse(scenario: string, body: HuggingfaceBody): void {
  hfRegistry.set(scenario, body);
}

/** Look up a registered Hugging Face response by scenario name. */
export function getHuggingfaceResponse(scenario: string): HuggingfaceBody | undefined {
  return hfRegistry.get(scenario);
}

/**
 * Register a scenario-keyed Cloudflare Radar response. The same
 * registry serves all Radar surfaces (trending, services, ai-bots)
 * because the MSW handler routes purely by `x-test-scenario` header
 * — the body is whatever shape the test wants. Pass `{ __denied: 429 }`
 * (or any HTTP code ≥ 400) to simulate rate-limit / forbidden.
 */
export function setCloudflareRadarResponse(
  scenario: string,
  body: CloudflareBody,
): void {
  cfRegistry.set(scenario, body);
}

/** Look up a registered Cloudflare Radar response by scenario name. */
export function getCloudflareRadarResponse(
  scenario: string,
): CloudflareBody | undefined {
  return cfRegistry.get(scenario);
}

/** Clear all scanner mock registries. Call in afterEach hooks. */
export function resetScannerMocks(): void {
  hnRegistry.clear();
  arxivRegistry.clear();
  ghRegistry.clear();
  redditRegistry.clear();
  hfRegistry.clear();
  cfRegistry.clear();
}
