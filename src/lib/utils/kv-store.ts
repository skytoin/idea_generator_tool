/**
 * Minimal key-value store interface. The Frame orchestrator persists
 * FrameOutput keyed by profile_hash so runs can be inspected later.
 * Implementations: InMemoryKVStore (tests + CLI default), future Upstash adapter.
 */
export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/**
 * In-memory KV store backed by a Map. Used in tests and dev dry-runs.
 * Each instance has its own independent state — two instances never share data.
 */
export class InMemoryKVStore implements KVStore {
  private readonly store: Map<string, string>;

  /** Create an empty in-memory store. */
  constructor() {
    this.store = new Map();
  }

  /** Return the string at `key`, or null if not present. */
  async get(key: string): Promise<string | null> {
    const value = this.store.get(key);
    return value === undefined ? null : value;
  }

  /** Insert or overwrite the value at `key`. */
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  /** Remove `key` if present. No-op if missing. */
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Return true if `key` is currently stored. */
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}
