import { z } from 'zod';
import type { FounderProfile } from '../../lib/types/founder-profile';
import type { ScannerDirectives } from '../../lib/types/scanner-directives';

/**
 * Response schema for the Tech Scout keyword expansion LLM call. The
 * LLM returns an expanded query plan keyed by source-specific axes so
 * each adapter (HN, arxiv, GitHub) can build targeted queries without
 * re-running the LLM.
 */
export const EXPANSION_RESPONSE_SCHEMA = z.object({
  expanded_keywords: z.array(z.string().min(1)).min(3).max(10),
  arxiv_categories: z.array(z.string().min(1)).min(0).max(5),
  github_languages: z.array(z.string().min(1)).min(0).max(5),
  domain_tags: z.array(z.string().min(1)).min(0).max(10),
});

export type ExpansionResponse = z.infer<typeof EXPANSION_RESPONSE_SCHEMA>;

/**
 * Build the system prompt for Tech Scout keyword expansion. Injects a
 * scenario marker when provided so the MSW mock can route test
 * responses to the correct fixture branch.
 */
export function buildExpansionSystemPrompt(scenario?: string): string {
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  return `${marker}You are a research query planner for a Tech Scout agent. Given a founder directive and profile, expand the directive keywords into a rich query plan usable by multiple research sources (Hacker News, arxiv, GitHub).

Rules:
1. expanded_keywords: 3-10 concrete technical terms.
   - ORDERING IS CRITICAL. List the MOST SPECIFIC terms FIRST, the MOST GENERIC LAST. Downstream source adapters only use the first few keywords, so generic umbrella terms buried at position 1-3 produce useless queries.
   - Avoid generic umbrella terms as the first entries: "AI", "ML", "machine learning", "data science", "Python", "SaaS", "software", "startup", "cloud", "analytics". If these are in the directive's keywords, keep them but place them at the END of expanded_keywords.
   - Include at least 2-3 highly specific terms derived from the founder's actual skills, domain, insider knowledge, or notes (e.g., "retrieval augmented generation", "vector database", "agentic pipelines", "LLM tool use", "SOC-2 automation", "fraud ML scoring").
   - Include synonyms and closely related technical terms that would help retrieval on HN / arxiv / GitHub.
2. arxiv_categories: list of arxiv subject category codes (e.g., cs.LG, cs.CR, stat.ML, cs.DB). Pick categories that actually match the founder's domain. Leave empty if no match.
3. github_languages: programming languages matching the founder's stated skills. Prefer lowercase names ("python", "rust"). Leave empty if the founder's skills don't map to specific languages.
4. domain_tags: short industry/vertical tags (e.g., "fintech", "healthcare", "e-commerce").
5. NEVER include any term from the directive's exclude list in expanded_keywords.
6. ACRONYM DISAMBIGUATION: When the founder's notes or directive contain an acronym you don't recognize with high confidence, preserve the acronym VERBATIM in expanded_keywords rather than guessing its expansion. For example, "MCP" in 2026 AI context most commonly means "Model Context Protocol" but could also mean "Multi-Cloud Platform" or a domain-specific term — keep it as "MCP" and let downstream searches disambiguate.
7. Output must match the provided JSON schema exactly.`;
}

/**
 * Build the user prompt for Tech Scout keyword expansion. Serializes
 * the directive and the relevant founder profile fields so the LLM
 * has everything it needs without additional context.
 */
export function buildExpansionUserPrompt(
  directive: ScannerDirectives['tech_scout'],
  profile: FounderProfile,
): string {
  const skills = profile.skills.value.join(', ');
  const domains = profile.domain.value
    .map((d) => `${d.area}${d.years ? ` (${d.years}y)` : ''}`)
    .join(', ');
  const excludeList =
    directive.exclude.length > 0 ? directive.exclude.join(', ') : '(none)';
  return `Directive keywords: ${directive.keywords.join(', ')}
Directive exclude (NEVER include in expanded_keywords): ${excludeList}
Directive notes: ${directive.notes || '(none)'}
Directive timeframe: ${directive.timeframe}

Founder skills: ${skills}
Founder domain(s): ${domains || '(none stated)'}

Produce the expanded query plan as a JSON object matching the schema.`;
}
