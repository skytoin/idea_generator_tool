import Link from 'next/link';

/**
 * Project landing page. Points to the Layer 1 Frame routes so developers
 * landing at the root URL can reach the intake form and debug inspector
 * without guessing paths.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 p-8 font-sans">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Idea Generation Pipeline
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Multi-step AI pipeline that generates, filters, and ranks startup ideas
        </h1>
        <p className="text-zinc-600">
          Layer 1 (Frame) is complete. Layers 2–8 are not yet built.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Layer 1 — Frame (user intake)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/frame"
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-900 hover:bg-zinc-50"
          >
            <span className="font-medium">/frame</span>
            <span className="text-sm text-zinc-600">
              The founder intake form. Fills out a FounderProfile, runs it through
              the pipeline, returns narrative + scanner directives.
            </span>
          </Link>
          <Link
            href="/debug/frame"
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-900 hover:bg-zinc-50"
          >
            <span className="font-medium">/debug/frame</span>
            <span className="text-sm text-zinc-600">
              Debug inspector. Load a golden fixture or paste FrameInput JSON,
              click Run, see profile + narrative + directives + trace + cost.
            </span>
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm text-zinc-600">
        <h3 className="font-semibold text-zinc-900">CLI</h3>
        <pre className="overflow-x-auto rounded bg-zinc-900 p-4 text-xs text-zinc-100">
          npm run frame:dry-run -- src/__tests__/pipeline/frame/fixtures/alice-minimum.json
        </pre>
      </section>

      <footer className="text-xs text-zinc-500">
        See <code className="font-mono">docs/architecture.md</code> for the full
        8-step pipeline design and{' '}
        <code className="font-mono">docs/frame-evaluation-rubric.md</code> for
        the Layer 1 evaluation checklist.
      </footer>
    </main>
  );
}
