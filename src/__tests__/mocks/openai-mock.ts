/**
 * In-memory registry of scenario-keyed OpenAI responses for tests.
 * Tests set a scenario before making an LLM call; the MSW handler
 * inspects the request body for `[[SCENARIO:name]]` and returns the
 * registered response.
 */

export type OpenAIMockResponse = {
  /** The content string the mock returns in choices[0].message.content */
  content: string;
  /** Optional model name to echo back */
  model?: string;
  /** Optional token usage */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

const registry = new Map<string, OpenAIMockResponse>();

const SCENARIO_REGEX = /\[\[SCENARIO:([a-zA-Z0-9_\-.]+)\]\]/;

/** Register a mock response for a given scenario name. */
export function setOpenAIResponse(scenario: string, response: OpenAIMockResponse): void {
  registry.set(scenario, response);
}

/** Look up a registered response by scenario name. */
export function getOpenAIResponse(scenario: string): OpenAIMockResponse | undefined {
  return registry.get(scenario);
}

/** Clear all registered responses. Call in afterEach. */
export function resetOpenAIMock(): void {
  registry.clear();
}

/**
 * Extract a scenario name from a single content value, which may be a plain
 * string or an array of parts ({ text } / { type, text } objects).
 */
function scenarioFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const match = SCENARIO_REGEX.exec(content);
    return match?.[1];
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string') {
          const match = SCENARIO_REGEX.exec(text);
          if (match) return match[1];
        }
      } else if (typeof part === 'string') {
        const match = SCENARIO_REGEX.exec(part);
        if (match) return match[1];
      }
    }
  }
  return undefined;
}

/**
 * Extract the scenario name from an OpenAI request body.
 * Looks for `[[SCENARIO:name]]` in any message's content field, across both
 * the chat/completions `messages` shape and the new responses `input` shape.
 * Returns the name (without brackets) or undefined.
 */
export function extractScenarioFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const collections = [record.messages, record.input];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const message of collection) {
      if (!message || typeof message !== 'object') continue;
      const content = (message as { content?: unknown }).content;
      const found = scenarioFromContent(content);
      if (found) return found;
    }
  }
  return undefined;
}
