import type { FounderProfileField } from './founder-profile';

export const CONSUMERS = [
  'narrative',
  'tech_scout',
  'pain_scanner',
  'market_scanner',
  'change_scanner',
] as const;
export type Consumer = (typeof CONSUMERS)[number];

export type CoverageEntry = {
  consumers: Consumer[];
  required_in_prompt: boolean;
};

/**
 * Declares which downstream artifacts each FounderProfile field must influence.
 * Enforced by tests — a field added to FounderProfile without an entry here
 * will cause CI to fail. This is the primary defense against orphaned data.
 */
export const FIELD_COVERAGE: Record<FounderProfileField, CoverageEntry> = {
  skills: {
    consumers: ['narrative', 'tech_scout', 'pain_scanner'],
    required_in_prompt: true,
  },
  time_per_week: { consumers: ['narrative'], required_in_prompt: true },
  money_available: { consumers: ['narrative'], required_in_prompt: true },
  ambition: { consumers: ['narrative', 'market_scanner'], required_in_prompt: true },
  domain: {
    consumers: ['narrative', 'tech_scout', 'pain_scanner', 'market_scanner'],
    required_in_prompt: true,
  },
  insider_knowledge: {
    consumers: ['narrative', 'pain_scanner'],
    required_in_prompt: true,
  },
  anti_targets: {
    consumers: [
      'narrative',
      'tech_scout',
      'pain_scanner',
      'market_scanner',
      'change_scanner',
    ],
    required_in_prompt: true,
  },
  network: { consumers: ['narrative', 'market_scanner'], required_in_prompt: false },
  audience: { consumers: ['narrative', 'market_scanner'], required_in_prompt: false },
  proprietary_access: {
    consumers: ['narrative', 'tech_scout'],
    required_in_prompt: false,
  },
  rare_combinations: { consumers: ['narrative'], required_in_prompt: false },
  recurring_frustration: {
    consumers: ['narrative', 'pain_scanner'],
    required_in_prompt: false,
  },
  four_week_mvp: { consumers: ['narrative'], required_in_prompt: false },
  previous_attempts: {
    consumers: ['narrative', 'market_scanner'],
    required_in_prompt: false,
  },
  customer_affinity: {
    consumers: ['narrative', 'pain_scanner'],
    required_in_prompt: false,
  },
  time_to_revenue: { consumers: ['narrative'], required_in_prompt: false },
  customer_type_preference: {
    consumers: ['narrative', 'market_scanner'],
    required_in_prompt: false,
  },
  trigger: { consumers: ['narrative'], required_in_prompt: false },
  legal_constraints: {
    consumers: ['narrative', 'change_scanner'],
    required_in_prompt: false,
  },
  divergence_level: {
    consumers: [
      'narrative',
      'tech_scout',
      'pain_scanner',
      'market_scanner',
      'change_scanner',
    ],
    required_in_prompt: true,
  },
};
