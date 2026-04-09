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

/** Render a single scanner directive section. */
function ScannerSection({
  name,
  directive,
}: {
  name: string;
  directive: FrameOutput['directives'][keyof FrameOutput['directives']];
}): React.ReactElement {
  return (
    <details className="mb-2">
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

/** Render the trace summary and cost. */
function TraceAndCost({ output }: { output: FrameOutput }): React.ReactElement {
  return (
    <section className="mb-4">
      <h2 className="text-xl font-bold">Trace</h2>
      <p>{output.debug.trace.length} field-&gt;consumer pairs</p>
      <h2 className="text-xl font-bold mt-2">Cost</h2>
      <p>${output.debug.cost_usd.toFixed(4)} USD</p>
    </section>
  );
}

/**
 * Pure presentational view for a FrameOutput. Displays the run header,
 * profile table with confidence badges, narrative, directives, trace
 * summary, and USD cost. Stateless and does no fetching — the parent
 * page orchestrates API calls and passes results in as props.
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
      <NarrativeSection output={output} />
      <DirectivesPanel output={output} />
      <TraceAndCost output={output} />
    </div>
  );
}
