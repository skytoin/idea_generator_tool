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

const hnRegistry = new Map<string, HnBody>();
const arxivRegistry = new Map<string, ArxivBody>();
const ghRegistry = new Map<string, GhBody>();

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

/** Clear all scanner mock registries. Call in afterEach hooks. */
export function resetScannerMocks(): void {
  hnRegistry.clear();
  arxivRegistry.clear();
  ghRegistry.clear();
}
