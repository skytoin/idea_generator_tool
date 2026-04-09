import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CLIENT_STATE_VERSION,
  saveDraft,
  loadDraft,
  clearDraft,
} from '../../../lib/frame/client-state';

const STORAGE_KEY = 'frame:draft';

describe('client-state draft persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('loadDraft returns null when nothing is saved', () => {
    expect(loadDraft()).toBeNull();
  });

  it('round-trips a saved partial input', () => {
    saveDraft({ skills: ['React'] });
    expect(loadDraft()).toEqual({ skills: ['React'] });
  });

  it('returns null and warns when stored JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadDraft()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null when the stored envelope has the wrong version', () => {
    const stale = { version: CLIENT_STATE_VERSION + 1, saved_at: '', input: { skills: ['X'] } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    expect(loadDraft()).toBeNull();
  });

  it('clearDraft removes the stored entry', () => {
    saveDraft({ skills: ['A'] });
    expect(loadDraft()).not.toBeNull();
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('saveDraft uses the injected clock for saved_at', () => {
    const fixed = new Date('2030-01-02T03:04:05.000Z');
    saveDraft({ skills: ['A'] }, () => fixed);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    const parsed = JSON.parse(raw);
    expect(parsed.saved_at).toBe(fixed.toISOString());
    expect(parsed.version).toBe(CLIENT_STATE_VERSION);
  });

  it('no-ops silently when localStorage is unavailable (SSR)', () => {
    const original = globalThis.localStorage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
    try {
      expect(() => saveDraft({ skills: ['A'] })).not.toThrow();
      expect(() => clearDraft()).not.toThrow();
      expect(loadDraft()).toBeNull();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).localStorage = original;
    }
  });
});
