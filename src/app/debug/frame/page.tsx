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

/** POST the pasted JSON to the extract route and return the parsed output. */
async function postExtract(inputJson: string): Promise<FrameOutput> {
  const body = JSON.parse(inputJson);
  const res = await fetch('/api/frame/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      setOutput(await postExtract(inputJson));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

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
