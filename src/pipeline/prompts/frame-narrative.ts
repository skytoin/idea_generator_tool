import type { FounderProfile, FounderProfileField } from '../../lib/types/founder-profile';
import { PromptTrace } from '../frame/prompt-trace';

type Mode = 'explore' | 'refine' | 'open_direction';

/**
 * Format a domain array as a human-readable list of "area (years)" entries.
 * Null years render as "?". Empty arrays render as "none reported".
 */
function formatDomain(value: Array<{ area: string; years: number | null }>): string {
  if (value.length === 0) return 'none reported';
  return value.map((d) => `${d.area} (${d.years ?? '?'} yrs)`).join(', ');
}

/** Format a string[] as comma-separated, "none" when empty. */
function formatStringArray(value: string[]): string {
  return value.length === 0 ? 'none' : value.join(', ');
}

/** Serialize a field value into the string that will land in the prompt. */
function formatFieldValue(field: FounderProfileField, value: unknown): string {
  if (field === 'domain')
    return formatDomain(value as Array<{ area: string; years: number | null }>);
  if (field === 'skills' || field === 'anti_targets')
    return formatStringArray(value as string[]);
  if (value === null) return 'not stated';
  if (typeof value === 'string') return value;
  return String(value);
}

/** Append a "(source)" suffix when source is not `stated`. */
function tag(source: 'stated' | 'inferred' | 'assumed'): string {
  return source === 'stated' ? '' : ` (${source})`;
}

/**
 * Build one bullet line "- field{tag}: value" and record the field in the
 * trace. Value formatting is dispatched via formatFieldValue.
 */
function line(
  trace: PromptTrace,
  profile: FounderProfile,
  field: FounderProfileField,
): string {
  const entry = profile[field];
  trace.use(field, entry.value);
  return `- ${field}${tag(entry.source)}: ${formatFieldValue(field, entry.value)}`;
}

/** Render every profile field as a bullet list, recording each in the trace. */
function renderProfileBullets(profile: FounderProfile, trace: PromptTrace): string {
  return [
    line(trace, profile, 'skills'),
    line(trace, profile, 'time_per_week'),
    line(trace, profile, 'money_available'),
    line(trace, profile, 'ambition'),
    line(trace, profile, 'domain'),
    line(trace, profile, 'insider_knowledge'),
    line(trace, profile, 'anti_targets'),
    line(trace, profile, 'network'),
    line(trace, profile, 'audience'),
    line(trace, profile, 'proprietary_access'),
    line(trace, profile, 'rare_combinations'),
    line(trace, profile, 'recurring_frustration'),
    line(trace, profile, 'four_week_mvp'),
    line(trace, profile, 'previous_attempts'),
    line(trace, profile, 'customer_affinity'),
    line(trace, profile, 'time_to_revenue'),
    line(trace, profile, 'customer_type_preference'),
    line(trace, profile, 'trigger'),
    line(trace, profile, 'legal_constraints'),
    line(trace, profile, 'divergence_level'),
  ].join('\n');
}

/** Render the mode-specific section of the user prompt. */
function renderModeSection(mode: Mode, existingIdea: string | null): string {
  if (mode === 'refine' && existingIdea !== null) {
    return `Mode: refine\nAnchor your summary on this anchor verbatim:\n${existingIdea}`;
  }
  if (mode === 'open_direction' && existingIdea !== null) {
    return `Mode: open_direction\nThe founder has a rough direction. Current direction:\n${existingIdea}`;
  }
  return `Mode: explore\nThe founder is searching broadly — describe their situation without anchoring on a specific product.`;
}

/**
 * Build the narrative step system + user prompts. Records every profile
 * field accessed via a PromptTrace bound to the 'narrative' consumer so the
 * orphan-detection invariant suite can prove field coverage.
 */
export function buildNarrativePrompt(
  profile: FounderProfile,
  mode: Mode,
  existingIdea: string | null,
  scenario?: string,
): { system: string; user: string; trace: PromptTrace } {
  const trace = new PromptTrace('narrative');
  const marker = scenario ? `[[SCENARIO:${scenario}]]\n` : '';
  const system = `${marker}You are a founder summarization assistant. Given a structured founder profile, produce a natural-language prose summary of approximately 200 words. Distinguish between stated, inferred, and assumed facts — highlight stated facts confidently and hedge on assumed fields. Keep the summary grounded; do not invent details.`;
  const bullets = renderProfileBullets(profile, trace);
  const user = `${renderModeSection(mode, existingIdea)}

Founder profile:
${bullets}

Write a ~200 word prose summary. Do not output JSON — plain prose only.`;
  return { system, user, trace };
}
