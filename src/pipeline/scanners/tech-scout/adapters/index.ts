import { hnAlgoliaAdapter } from './hn-algolia';
import { arxivAdapter } from './arxiv';
import { githubAdapter } from './github';
import { redditAdapter } from './reddit';
import { huggingfaceAdapter } from './huggingface';
import { cloudflareRadarAdapter } from './cloudflare-radar';
import type { SourceAdapter } from '../../types';

/**
 * The Tech Scout adapter registry. Scanner orchestrator iterates this in
 * parallel. Adding a new source = new file in this folder + one entry here.
 */
export const TECH_SCOUT_ADAPTERS: readonly SourceAdapter[] = [
  hnAlgoliaAdapter,
  arxivAdapter,
  githubAdapter,
  redditAdapter,
  huggingfaceAdapter,
  cloudflareRadarAdapter,
];

export {
  hnAlgoliaAdapter,
  arxivAdapter,
  githubAdapter,
  redditAdapter,
  huggingfaceAdapter,
  cloudflareRadarAdapter,
};
