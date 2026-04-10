import type React from 'react';
import type { FrameOutput } from '../../lib/types/frame-output';

type Source = 'stated' | 'inferred' | 'assumed';

type FrameDebugViewProps = {
  output: FrameOutput | null;
  error: string | null;
};

type ProfileEntry = { value: unknown; source: Source };

const SCANNER_NAMES = [
  'tech_scout',
  'pain_scanner',
  'market_scanner',
  'change_scanner',
] as const;

const OMITTED_PROFILE_KEYS = new Set([
  'additional_context_raw',
  'schema_version',
  'profile_hash',
]);

/** Map a confidence source to a Tailwind color class for the badge. */
function sourceClass(source: Source): string {
  if (source === 'stated') return 'bg-green-200 text-green-900';
  if (source === 'inferred') return 'bg-yellow-200 text-yellow-900';
  return 'bg-gray-200 text-gray-900';
}

/** Render a single row in the profile table. */
function ProfileRow({ name, entry }: { name: string; entry: ProfileEntry }): React.ReactElement {
  return (
    <tr key={name}>
      <td className="pr-4 font-mono text-sm align-top">{name}</td>
      <td className="pr-4 font-mono text-sm align-top">
        <pre className="whitespace-pre-wrap">{JSON.stringify(entry.value)}</pre>
      </td>
      <td className="align-top">
        <span className={`px-2 py-0.5 rounded text-xs ${sourceClass(entry.source)}`}>
          {entry.source}
        </span>
      </td>
    </tr>
  );
}

/** Render the header showing mode and existing idea badge. */
function Header({ output }: { output: FrameOutput }): React.ReactElement {
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Run Header</h2>
      <p>
        <strong>mode:</strong> <code>{output.mode}</code>
      </p>
      <p>
        <strong>existing_idea:</strong>{' '}
        <code>{output.existing_idea?.description ?? '(none)'}</code>
      </p>
      <p>
        <strong>generated_at:</strong> <code>{output.debug.generated_at}</code>
      </p>
    </section>
  );
}

/** Extract the iterable list of profile entries, skipping metadata fields. */
function profileEntries(output: FrameOutput): Array<[string, ProfileEntry]> {
  const raw = output.profile as unknown as Record<string, ProfileEntry | unknown>;
  const out: Array<[string, ProfileEntry]> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (OMITTED_PROFILE_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && 'source' in (value as Record<string, unknown>)) {
      out.push([key, value as ProfileEntry]);
    }
  }
  return out;
}

/** Render the profile field table. */
function ProfileTable({ output }: { output: FrameOutput }): React.ReactElement {
  const entries = profileEntries(output);
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Profile</h2>
      <table className="border-collapse">
        <tbody>
          {entries.map(([name, entry]) => (
            <ProfileRow key={name} name={name} entry={entry} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Render the verbatim additional_context_raw that the founder typed into
 * the 'Anything else I should know about you?' box. Shown as its own
 * section so the user can confirm their free-text note was captured.
 * Displays a muted placeholder when the founder left it empty.
 */
function AdditionalContextSection({
  output,
}: {
  output: FrameOutput;
}): React.ReactElement {
  const raw = output.profile.additional_context_raw;
  const isEmpty = raw.trim().length === 0;
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Additional Context (verbatim)</h2>
      {isEmpty ? (
        <p className="text-sm text-gray-500 italic">(empty — no free-text note submitted)</p>
      ) : (
        <pre
          className="whitespace-pre-wrap border-l-4 border-blue-300 bg-blue-50 p-3 text-sm"
          data-testid="additional-context-raw"
        >
          {raw}
        </pre>
      )}
      <p className="text-xs text-gray-500 mt-1">
        {raw.length} character{raw.length === 1 ? '' : 's'}. When non-empty, this text is
        wrapped in a &lt;founder_notes&gt; block inside the narrative and every scanner
        directive prompt.
      </p>
    </section>
  );
}

/** Render the narrative prose and word count. */
function NarrativeSection({ output }: { output: FrameOutput }): React.ReactElement {
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Narrative</h2>
      <p className="whitespace-pre-wrap">{output.narrative.prose}</p>
      <p className="text-sm text-gray-600">{output.narrative.word_count} words</p>
    </section>
  );
}

/** Render the scanner-specific extra fields (target_sources, timeframe, etc.). */
function ScannerExtraFields({
  name,
  directive,
}: {
  name: string;
  directive: FrameOutput['directives'][keyof FrameOutput['directives']];
}): React.ReactElement {
  const d = directive as Record<string, unknown>;
  const skip = new Set(['keywords', 'exclude', 'notes']);
  const extras = Object.entries(d).filter(([k]) => !skip.has(k));
  return (
    <>
      {extras.map(([k, v]) => (
        <p key={`${name}-${k}`}>
          <strong>{k}:</strong> {JSON.stringify(v)}
        </p>
      ))}
    </>
  );
}

/** Render a single scanner directive section, including scanner-specific fields. */
function ScannerSection({
  name,
  directive,
}: {
  name: string;
  directive: FrameOutput['directives'][keyof FrameOutput['directives']];
}): React.ReactElement {
  return (
    <details className="mb-2" open>
      <summary className="font-semibold cursor-pointer">{name}</summary>
      <div className="pl-4">
        <p>
          <strong>keywords:</strong> {JSON.stringify(directive.keywords)}
        </p>
        <p>
          <strong>exclude:</strong> {JSON.stringify(directive.exclude)}
        </p>
        <p>
          <strong>notes:</strong> {directive.notes}
        </p>
        <ScannerExtraFields name={name} directive={directive} />
      </div>
    </details>
  );
}

/** Render the directives panel containing all four scanner sections. */
function DirectivesPanel({ output }: { output: FrameOutput }): React.ReactElement {
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Directives</h2>
      {SCANNER_NAMES.map((name) => (
        <ScannerSection key={name} name={name} directive={output.directives[name]} />
      ))}
    </section>
  );
}

/**
 * Group (field, consumer) trace pairs by field so the user can see at a
 * glance which consumers each field influenced. Returns an array of
 * [field, consumers[]] tuples sorted alphabetically by field name.
 */
function groupTraceByField(
  trace: Array<{ field: string; consumer: string }>,
): Array<[string, string[]]> {
  const map = new Map<string, Set<string>>();
  for (const { field, consumer } of trace) {
    const set = map.get(field) ?? new Set<string>();
    set.add(consumer);
    map.set(field, set);
  }
  return Array.from(map.entries())
    .map(([field, set]) => [field, Array.from(set).sort()] as [string, string[]])
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Render the trace section as an expandable table of field -> consumer[].
 * Keeps the summary count for quick scanning but lets the founder drill
 * in to see the exact mapping, which is the main evidence that every
 * collected field flowed into at least one downstream consumer.
 */
function TraceSection({ output }: { output: FrameOutput }): React.ReactElement {
  const grouped = groupTraceByField(output.debug.trace);
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Trace</h2>
      <details>
        <summary className="cursor-pointer">
          {output.debug.trace.length} field-&gt;consumer pairs across {grouped.length}{' '}
          distinct fields (click to expand)
        </summary>
        <table className="border-collapse mt-2" data-testid="trace-details-table">
          <thead>
            <tr>
              <th className="pr-4 text-left font-mono text-sm">field</th>
              <th className="text-left font-mono text-sm">consumers</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([field, consumers]) => (
              <tr key={field}>
                <td className="pr-4 font-mono text-xs align-top">{field}</td>
                <td className="font-mono text-xs align-top">{consumers.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

/** Render the USD cost line. */
function CostSection({ output }: { output: FrameOutput }): React.ReactElement {
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Cost</h2>
      <p>${output.debug.cost_usd.toFixed(4)} USD</p>
    </section>
  );
}

/**
 * Pure presentational view for a FrameOutput. Displays the run header,
 * profile table with confidence badges, the verbatim additional_context
 * block, the narrative prose, each scanner directive (including scanner-
 * specific fields), a collapsible trace table grouped by field, and the
 * USD cost. Stateless and does no fetching — the parent page orchestrates
 * API calls and passes results in as props.
 */
export function FrameDebugView({ output, error }: FrameDebugViewProps): React.ReactElement {
  if (error !== null) {
    return (
      <div role="alert" className="text-red-700">
        <strong>Error:</strong> {error}
      </div>
    );
  }
  if (output === null) {
    return <div className="text-gray-500">no output yet</div>;
  }
  return (
    <div>
      <Header output={output} />
      <ProfileTable output={output} />
      <AdditionalContextSection output={output} />
      <NarrativeSection output={output} />
      <DirectivesPanel output={output} />
      <TraceSection output={output} />
      <CostSection output={output} />
    </div>
  );
}
