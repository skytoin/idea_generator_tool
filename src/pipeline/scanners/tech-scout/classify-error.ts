import { TimeoutError } from '../../../lib/utils/with-timeout';
import { GithubDeniedError } from './adapters/github';
import type { SourceReport } from '../../../lib/types/source-report';

/** Source status narrowed to the three error buckets a failed fetch produces. */
type ErrorStatus = Extract<
  SourceReport['status'],
  'timeout' | 'denied' | 'failed'
>;

/**
 * Classify an unknown error thrown by a source adapter's fetch() into one
 * of three source statuses. TimeoutError and AbortError → timeout;
 * GithubDeniedError or messages matching rate-limit/denied/429 patterns →
 * denied; everything else → failed. Never throws, so orchestrator can use
 * this in catch blocks without worrying about secondary failures.
 */
export function classifyError(e: unknown): ErrorStatus {
  if (e instanceof TimeoutError) return 'timeout';
  if (e instanceof GithubDeniedError) return 'denied';
  if (e instanceof Error) {
    if (e.name === 'AbortError') return 'timeout';
    const msg = e.message.toLowerCase();
    if (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('denied')
    ) {
      return 'denied';
    }
  }
  return 'failed';
}
