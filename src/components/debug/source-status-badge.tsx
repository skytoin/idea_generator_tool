'use client';

import type { ReactElement } from 'react';
import type { SourceReport } from '../../lib/types/source-report';

const CLASSES: Record<SourceReport['status'], string> = {
  ok: 'bg-green-200 text-green-900',
  ok_empty: 'bg-yellow-200 text-yellow-900',
  timeout: 'bg-orange-200 text-orange-900',
  denied: 'bg-red-200 text-red-900',
  failed: 'bg-red-300 text-red-900',
};

const LABELS: Record<SourceReport['status'], string> = {
  ok: 'ok',
  ok_empty: 'empty',
  timeout: 'timeout',
  denied: 'denied',
  failed: 'failed',
};

/**
 * Color-coded status badge for a scanner source outcome. Green = ok,
 * yellow = ok_empty (no results, not an error), orange = timeout,
 * red = denied/failed. The optional title prop sets the element's
 * hover tooltip so the reader can get the full error message by
 * pointing at the badge.
 */
export function SourceStatusBadge({
  status,
  title,
}: {
  status: SourceReport['status'];
  title?: string;
}): ReactElement {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs ${CLASSES[status]}`}
      title={title}
    >
      {LABELS[status]}
    </span>
  );
}
