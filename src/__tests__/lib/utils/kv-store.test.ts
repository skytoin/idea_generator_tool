import { describe, it, expect } from 'vitest';
import { InMemoryKVStore } from '../../../lib/utils/kv-store';

describe('InMemoryKVStore', () => {
  it('set then get returns the stored value', async () => {
    const kv = new InMemoryKVStore();
    await kv.set('foo', 'bar');
    expect(await kv.get('foo')).toBe('bar');
  });

  it('get on missing key returns null', async () => {
    const kv = new InMemoryKVStore();
    expect(await kv.get('missing')).toBeNull();
  });

  it('set on existing key overwrites', async () => {
    const kv = new InMemoryKVStore();
    await kv.set('foo', 'v1');
    await kv.set('foo', 'v2');
    expect(await kv.get('foo')).toBe('v2');
  });

  it('delete removes an entry', async () => {
    const kv = new InMemoryKVStore();
    await kv.set('foo', 'bar');
    await kv.delete('foo');
    expect(await kv.get('foo')).toBeNull();
  });

  it('delete on missing key is a no-op', async () => {
    const kv = new InMemoryKVStore();
    await expect(kv.delete('missing')).resolves.toBeUndefined();
  });

  it('has returns true for existing key', async () => {
    const kv = new InMemoryKVStore();
    await kv.set('foo', 'bar');
    expect(await kv.has('foo')).toBe(true);
  });

  it('has returns false for missing key', async () => {
    const kv = new InMemoryKVStore();
    expect(await kv.has('missing')).toBe(false);
  });

  it('has returns false after delete', async () => {
    const kv = new InMemoryKVStore();
    await kv.set('foo', 'bar');
    await kv.delete('foo');
    expect(await kv.has('foo')).toBe(false);
  });

  it('two separate instances do not share state', async () => {
    const a = new InMemoryKVStore();
    const b = new InMemoryKVStore();
    await a.set('foo', 'from-a');
    expect(await b.get('foo')).toBeNull();
    expect(await b.has('foo')).toBe(false);
  });

  it('stores multiple keys independently', async () => {
    const kv = new InMemoryKVStore();
    await kv.set('a', '1');
    await kv.set('b', '2');
    await kv.set('c', '3');
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('b')).toBe('2');
    expect(await kv.get('c')).toBe('3');
    await kv.delete('b');
    expect(await kv.get('a')).toBe('1');
    expect(await kv.get('b')).toBeNull();
    expect(await kv.get('c')).toBe('3');
  });

  it('clear removes every key', async () => {
    const kv = new InMemoryKVStore();
    await kv.set('a', '1');
    await kv.set('b', '2');
    kv.clear();
    expect(await kv.get('a')).toBeNull();
    expect(await kv.get('b')).toBeNull();
    expect(await kv.has('a')).toBe(false);
  });
});
