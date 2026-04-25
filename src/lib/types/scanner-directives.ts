import { z } from 'zod';

const scannerHint = z.object({
  keywords: z.array(z.string()),
  exclude: z.array(z.string()),
  notes: z.string(),
});

/**
 * Per-scanner hints produced by the frame step. Each scanner gets
 * a shared set of hint fields plus its own specialized targeting fields.
 */
export const SCANNER_DIRECTIVES_SCHEMA = z.object({
  tech_scout: scannerHint.extend({
    target_sources: z.array(
      z.enum([
        'hn',
        'arxiv',
        'github',
        'reddit',
        'huggingface',
        'cloudflare',
        'producthunt',
      ]),
    ),
    timeframe: z.string(),
  }),
  pain_scanner: scannerHint.extend({
    target_subreddits: z.array(z.string()),
    personas: z.array(z.string()),
  }),
  market_scanner: scannerHint.extend({
    competitor_domains: z.array(z.string()),
    yc_batches_to_scan: z.array(z.string()),
  }),
  change_scanner: scannerHint.extend({
    regulatory_areas: z.array(z.string()),
    geographic: z.array(z.string()),
  }),
});

export type ScannerDirectives = z.infer<typeof SCANNER_DIRECTIVES_SCHEMA>;
