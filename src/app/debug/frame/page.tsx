'use client';

import type React from 'react';
import { useState } from 'react';
import { FrameDebugView } from '../../../components/debug/frame-debug-view';
import type { FrameOutput } from '../../../lib/types/frame-output';

/** Fixture choices the dropdown offers. */
const FIXTURES = [
  'alice-minimum',
  'bob-medium',
  'carol-full',
  'dave-nonenglish',
  'eve-adversarial',
] as const;

type FixtureName = (typeof FIXTURES)[number];

/** Load a fixture's JSON from the dev-only fixtures endpoint. */
async function fetchFixture(name: FixtureName): Promise<string> {
  const res = await fetch(`/fixtures/${name}`);
  if (!res.ok) throw new Error(`Fixture ${name} not available (${res.status})`);
  const json = await res.json();
  return JSON.stringify(json, null, 2);
}

/** The v2 tech-scout feature flag bag the debug page can toggle. */
type DebugFlags = {
  runTechScout: boolean;
  skill_remix: boolean;
  adjacent_worlds: boolean;
  two_pass: boolean;
};

/**
 * POST the pasted JSON to the extract route and return the parsed
 * output. Respects the debug page's feature-flag checkboxes by
 * translating them into the `x-run-tech-scout` and `x-scanner-features`
 * headers the API route consumes.
 */
async function postExtract(inputJson: string, flags: DebugFlags): Promise<FrameOutput> {
  const body = JSON.parse(inputJson);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (flags.runTechScout) headers['x-run-tech-scout'] = '1';
  if (flags.skill_remix || flags.adjacent_worlds || flags.two_pass) {
    headers['x-scanner-features'] = JSON.stringify({
      skill_remix: flags.skill_remix,
      adjacent_worlds: flags.adjacent_worlds,
      two_pass: flags.two_pass,
    });
  }
  const res = await fetch('/api/frame/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as FrameOutput;
}

/**
 * Dev-only Frame debug page. Provides a JSON textarea and fixture
 * dropdown, runs the Frame API route, and renders the result through
 * FrameDebugView. Intentionally plain — no metadata export so this
 * page is never indexed.
 */
export default function DebugFramePage(): React.ReactElement {
  const [inputJson, setInputJson] = useState('');
  const [output, setOutput] = useState<FrameOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [flags, setFlags] = useState<DebugFlags>({
    runTechScout: true,
    skill_remix: false,
    adjacent_worlds: false,
    two_pass: false,
  });

  async function onLoadFixture(name: FixtureName): Promise<void> {
    try {
      setInputJson(await fetchFixture(name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRun(): Promise<void> {
    setRunning(true);
    setError(null);
    setOutput(null);
    try {
      setOutput(await postExtract(inputJson, flags));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const toggleFlag = (key: keyof DebugFlags) => () => {
    setFlags((f) => ({ ...f, [key]: !f[key] }));
  };

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Frame Debug</h1>
      <div className="mb-4">
        <label className="mr-2">Fixture:</label>
        <select
          onChange={(e) => {
            const v = e.target.value as FixtureName;
            if (v) void onLoadFixture(v);
          }}
          defaultValue=""
        >
          <option value="">-- select --</option>
          {FIXTURES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="mb-4 border p-3">
        <legend className="text-sm font-semibold px-2">Tech Scout feature flags</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={flags.runTechScout}
              onChange={toggleFlag('runTechScout')}
            />
            <span>
              Run Tech Scout <span className="text-gray-500">(x-run-tech-scout)</span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={flags.skill_remix}
              onChange={toggleFlag('skill_remix')}
              disabled={!flags.runTechScout}
            />
            <span>Skill Remix</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={flags.adjacent_worlds}
              onChange={toggleFlag('adjacent_worlds')}
              disabled={!flags.runTechScout}
            />
            <span>Adjacent Worlds</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={flags.two_pass}
              onChange={toggleFlag('two_pass')}
              disabled={!flags.runTechScout}
            />
            <span>Two-Pass</span>
          </label>
        </div>
      </fieldset>

      <textarea
        className="w-full h-64 p-2 border font-mono text-xs"
        value={inputJson}
        onChange={(e) => setInputJson(e.target.value)}
        placeholder="Paste FrameInput JSON here..."
      />
      <button
        type="button"
        className="mt-2 mb-4 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        onClick={() => void onRun()}
        disabled={running}
      >
        {running ? 'Running...' : 'Run Frame'}
      </button>
      <FrameDebugView output={output} error={error} />
    </main>
  );
}
