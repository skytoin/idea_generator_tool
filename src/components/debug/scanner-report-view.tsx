'use client';

import type { ReactElement } from 'react';
import type {
  ScannerReport,
  V2FeaturesMeta,
  V2StageStatus,
  TwoPassMeta,
} from '../../lib/types/scanner-report';
import type { SourceReport } from '../../lib/types/source-report';
import type { Signal } from '../../lib/types/signal';
import { SourceStatusBadge } from './source-status-badge';

const SCANNER_STATUS_CLASSES: Record<ScannerReport['status'], string> = {
  ok: 'bg-green-200 text-green-900',
  partial: 'bg-yellow-200 text-yellow-900',
  failed: 'bg-red-300 text-red-900',
};

/**
 * Compact pill rendering the scanner-level status. Distinct from
 * SourceStatusBadge which is tied to the per-source SOURCE_STATUS
 * enum (ok/ok_empty/timeout/denied/failed). Scanner-level status
 * is only ok/partial/failed so the mapping is different.
 */
function ScannerStatusPill({
  status,
}: {
  status: ScannerReport['status'];
}): ReactElement {
  return (
    <span
      data-testid="scanner-status-pill"
      className={`px-2 py-0.5 rounded text-xs font-semibold ${SCANNER_STATUS_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}

/**
 * Render the top summary line: scanner name as a heading, status pill,
 * and the generated_at / elapsed_ms / cost_usd bookkeeping values.
 */
function ScannerHeader({ report }: { report: ScannerReport }): ReactElement {
  return (
    <div className="mb-2">
      <h2 className="text-xl font-bold inline">Scanner: {report.scanner}</h2>
      <span className="ml-3">
        <ScannerStatusPill status={report.status} />
      </span>
      <p className="text-sm text-gray-700 mt-1">
        generated_at <code>{report.generated_at}</code> · elapsed_ms{' '}
        <code>{report.elapsed_ms}</code> · cost_usd{' '}
        <code>${report.cost_usd.toFixed(4)}</code>
        {report.model_used != null && (
          <>
            {' '}
            · model <code data-testid="scanner-model-used">{report.model_used}</code>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Render one row in the per-source status table. Shows source name,
 * the SourceStatusBadge, signals_count, a comma-joined list of queries
 * that ran, elapsed_ms, cost_usd, and the error.kind if any.
 */
function SourceRow({ report }: { report: SourceReport }): ReactElement {
  const errorKind = report.error ? report.error.kind : null;
  const errorTitle = report.error ? report.error.message : undefined;
  return (
    <tr data-testid={`source-row-${report.name}`}>
      <td className="pr-4 font-mono text-sm">{report.name}</td>
      <td className="pr-4">
        <SourceStatusBadge status={report.status} title={errorTitle} />
      </td>
      <td className="pr-4 font-mono text-xs">{report.signals_count} sig</td>
      <td className="pr-4 font-mono text-xs">{report.queries_ran.join(', ')}</td>
      <td className="pr-4 font-mono text-xs">{report.elapsed_ms}ms</td>
      <td className="pr-4 font-mono text-xs">${report.cost_usd.toFixed(4)}</td>
      <td className="font-mono text-xs text-red-700">{errorKind ?? ''}</td>
    </tr>
  );
}

/** Render the <table> containing one SourceRow per source_report entry. */
function SourcesTable({ report }: { report: ScannerReport }): ReactElement {
  return (
    <section className="mb-3">
      <h3 className="font-semibold">Sources</h3>
      <table className="border-collapse text-sm">
        <tbody>
          {report.source_reports.map((sr) => (
            <SourceRow key={sr.name} report={sr} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Render the expansion_plan inside a collapsible <details> block.
 * When the plan is null (the scanner skipped planning), shows a small
 * italic placeholder instead of the JSON pre block.
 */
function ExpansionPlanDetails({
  plan,
}: {
  plan: ScannerReport['expansion_plan'];
}): ReactElement {
  return (
    <details className="mb-3" data-testid="expansion-plan-details">
      <summary className="cursor-pointer font-semibold">Expansion plan</summary>
      {plan === null ? (
        <p className="text-sm text-gray-500 italic">(no plan)</p>
      ) : (
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 p-2 rounded">
          {JSON.stringify(plan, null, 2)}
        </pre>
      )}
    </details>
  );
}

/** Render a single signal list item: linked title, source, score, snippet. */
function SignalItem({ signal }: { signal: Signal }): ReactElement {
  return (
    <li className="mb-2">
      <a
        href={signal.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-blue-700"
      >
        {signal.title}
      </a>
      <span className="ml-2 text-xs text-gray-600">
        {signal.source} · nov {signal.score.novelty} · spec {signal.score.specificity} ·
        rec {signal.score.recency} · {signal.category}
      </span>
      <p className="text-sm text-gray-700">{signal.snippet}</p>
    </li>
  );
}

/** Render the <ul> list containing every enriched signal in the report. */
function SignalsList({ report }: { report: ScannerReport }): ReactElement {
  return (
    <section className="mb-3">
      <h3 className="font-semibold">Signals ({report.signals.length})</h3>
      <ul>
        {report.signals.map((sig, i) => (
          <SignalItem key={`${sig.url}-${i}`} signal={sig} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Render the yellow-bordered warnings callout. The caller gates this
 * on warnings.length > 0 so we can assume there is at least one entry.
 */
function WarningsCallout({ warnings }: { warnings: string[] }): ReactElement {
  return (
    <section
      data-testid="scanner-warnings"
      className="mb-3 border-l-4 border-yellow-400 bg-yellow-50 p-2"
    >
      <h3 className="font-semibold text-yellow-900">Warnings</h3>
      <ul className="text-xs text-yellow-900">
        {warnings.map((w, i) => (
          <li key={`${w}-${i}`}>{w}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Render the red-bordered errors callout. The caller gates this on
 * errors.length > 0 so we can assume there is at least one entry.
 */
function ErrorsCallout({ errors }: { errors: ScannerReport['errors'] }): ReactElement {
  return (
    <section
      data-testid="scanner-errors"
      className="mb-3 border-l-4 border-red-500 bg-red-50 p-2"
    >
      <h3 className="font-semibold text-red-900">Errors</h3>
      <ul className="text-xs text-red-900">
        {errors.map((e, i) => (
          <li key={`${e.kind}-${i}`}>
            <strong>{e.kind}:</strong> {e.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Classes keyed by V2 stage status for the colored pill rendering. */
const V2_STAGE_CLASSES: Record<V2StageStatus['status'], string> = {
  disabled: 'bg-gray-200 text-gray-700',
  ok: 'bg-green-200 text-green-900',
  failed: 'bg-red-200 text-red-900',
};

/** Small pill rendering one v2 stage (skill_remix / adjacent_worlds). */
function V2StagePill({
  label,
  stage,
  outputLabel,
}: {
  label: string;
  stage: V2StageStatus;
  outputLabel: string;
}): ReactElement {
  const icon = stage.status === 'ok' ? '✓' : stage.status === 'failed' ? '✗' : '○';
  const suffix =
    stage.status === 'ok'
      ? ` (${stage.count} ${outputLabel})`
      : stage.status === 'failed'
        ? ` (failed: ${stage.error_kind ?? 'unknown'})`
        : ' (off)';
  return (
    <span
      data-testid={`v2-stage-${label}`}
      className={`px-2 py-0.5 rounded text-xs font-semibold ${V2_STAGE_CLASSES[stage.status]}`}
    >
      {icon} {label}
      {suffix}
    </span>
  );
}

/**
 * V2 features panel. Always rendered when the report carries
 * `v2_features_meta` so testers can confirm at a glance which v2
 * stages actually fired on this run. Disabled stages show a gray
 * pill so it is unambiguous that the flag was off — silence on
 * success was the previous failure mode we are fixing.
 */
function V2FeaturesPanel({ meta }: { meta: V2FeaturesMeta }): ReactElement {
  return (
    <section
      data-testid="v2-features-panel"
      className="mb-3 border-l-4 border-blue-400 bg-blue-50 p-2"
    >
      <h3 className="font-semibold text-blue-900 mb-1">V2 features</h3>
      <div className="flex flex-wrap gap-2">
        <V2StagePill label="skill_remix" stage={meta.skill_remix} outputLabel="hunts" />
        <V2StagePill
          label="adjacent_worlds"
          stage={meta.adjacent_worlds}
          outputLabel="worlds"
        />
        <span
          data-testid="v2-stage-two_pass"
          className={`px-2 py-0.5 rounded text-xs font-semibold ${
            meta.two_pass_enabled
              ? 'bg-green-200 text-green-900'
              : 'bg-gray-200 text-gray-700'
          }`}
        >
          {meta.two_pass_enabled ? '✓' : '○'} two_pass
          {meta.two_pass_enabled ? '' : ' (off)'}
        </span>
      </div>
    </section>
  );
}

/**
 * Two-pass metadata panel. Only rendered when the report carries
 * `two_pass_meta`. Shows pass1/pass2 signal counts, the classified
 * query buckets (dense / sparse / empty / exhausted), and whether
 * pass 2 was skipped (with the reason). The pass-2 plan itself
 * lives in a collapsible <details> so the panel stays compact.
 */
function TwoPassMetaPanel({ meta }: { meta: TwoPassMeta }): ReactElement {
  return (
    <section
      data-testid="two-pass-meta-panel"
      className="mb-3 border-l-4 border-purple-400 bg-purple-50 p-2"
    >
      <h3 className="font-semibold text-purple-900 mb-1">Two-pass metadata</h3>
      <p className="text-xs text-purple-900">
        pass1 <code>{meta.pass1_signal_count}</code> sig · pass2{' '}
        <code>{meta.pass2_signal_count}</code> sig
        {meta.pass2_skipped_reason && (
          <>
            {' '}
            · skipped reason <code>{meta.pass2_skipped_reason}</code>
          </>
        )}
      </p>
      <ul className="text-xs text-purple-900 mt-1">
        <li>
          <strong>dense:</strong>{' '}
          {meta.dense_directions.length > 0 ? meta.dense_directions.join(', ') : '(none)'}
        </li>
        <li>
          <strong>sparse:</strong>{' '}
          {meta.sparse_directions.length > 0
            ? meta.sparse_directions.join(', ')
            : '(none)'}
        </li>
        <li>
          <strong>empty:</strong>{' '}
          {meta.empty_queries.length > 0 ? meta.empty_queries.join(', ') : '(none)'}
        </li>
        <li>
          <strong>exhausted:</strong>{' '}
          {meta.exhausted_terms.length > 0 ? meta.exhausted_terms.join(', ') : '(none)'}
        </li>
      </ul>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-semibold text-purple-900">
          Pass 2 plan
        </summary>
        {meta.pass2_plan === null ? (
          <p className="text-xs text-purple-900 italic">(pass 2 did not run)</p>
        ) : (
          <pre className="text-xs whitespace-pre-wrap bg-white p-2 rounded">
            {JSON.stringify(meta.pass2_plan, null, 2)}
          </pre>
        )}
      </details>
    </section>
  );
}

/**
 * Pure presentational component for a ScannerReport. Returns null when
 * the report is undefined so parents can unconditionally render it.
 * Otherwise shows a header (name + status pill + bookkeeping), the
 * per-source status table, a collapsible expansion plan block, the
 * signals list, and warnings/errors callouts when non-empty. V2 and
 * two-pass metadata panels render whenever their fields are present
 * on the report — disabled v2 stages still show so testers can tell
 * which flags fired.
 */
export function ScannerReportView({
  report,
}: {
  report: ScannerReport | undefined;
}): ReactElement | null {
  if (report === undefined) return null;
  return (
    <section className="mb-6 border-t border-gray-200 pt-4">
      <ScannerHeader report={report} />
      {report.v2_features_meta && <V2FeaturesPanel meta={report.v2_features_meta} />}
      {report.two_pass_meta && <TwoPassMetaPanel meta={report.two_pass_meta} />}
      <SourcesTable report={report} />
      <ExpansionPlanDetails plan={report.expansion_plan} />
      <SignalsList report={report} />
      {report.warnings.length > 0 && <WarningsCallout warnings={report.warnings} />}
      {report.errors.length > 0 && <ErrorsCallout errors={report.errors} />}
    </section>
  );
}
