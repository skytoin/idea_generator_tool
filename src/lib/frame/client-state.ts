import type { FrameInput } from '../types/frame-input';

/**
 * Bump this whenever FrameInput schema changes in a way that would make an
 * older draft invalid. Old drafts are silently discarded on load.
 */
export const CLIENT_STATE_VERSION = 1 as const;

const STORAGE_KEY = 'frame:draft';

export type DraftEnvelope = {
  version: typeof CLIENT_STATE_VERSION;
  saved_at: string;
  input: Partial<FrameInput>;
};

/** Return true when `window.localStorage` is available in the current runtime. */
function hasLocalStorage(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
}

/**
 * Save a partial FrameInput to localStorage under a versioned envelope.
 * Silently no-ops when localStorage is unavailable (e.g. SSR) so callers
 * can invoke this freely from effects without guarding the runtime.
 */
export function saveDraft(input: Partial<FrameInput>, clock?: () => Date): void {
  if (!hasLocalStorage()) return;
  const envelope: DraftEnvelope = {
    version: CLIENT_STATE_VERSION,
    saved_at: (clock?.() ?? new Date()).toISOString(),
    input,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch (e) {
    console.warn('saveDraft: failed to write to localStorage', e);
  }
}

/**
 * Load a previously saved draft. Returns null if nothing is stored, if
 * parsing fails, or if the envelope version doesn't match
 * CLIENT_STATE_VERSION — in the latter two cases a warning is logged.
 */
export function loadDraft(): Partial<FrameInput> | null {
  if (!hasLocalStorage()) return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as DraftEnvelope;
    if (parsed.version !== CLIENT_STATE_VERSION) return null;
    return parsed.input;
  } catch (e) {
    console.warn('loadDraft: failed to parse stored draft', e);
    return null;
  }
}

/** Remove any saved draft. No-ops if localStorage is unavailable or empty. */
export function clearDraft(): void {
  if (!hasLocalStorage()) return;
  localStorage.removeItem(STORAGE_KEY);
}
