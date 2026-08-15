import { describe, expect, it } from 'vitest';
import { getPath } from './json-path';

describe('getPath', () => {
  it('reads a top-level key', () => {
    expect(getPath({ a: 1 }, 'a')).toBe(1);
  });

  it('reads a nested object path', () => {
    expect(
      getPath({ data: { buyer: { phone: '555' } } }, 'data.buyer.phone')
    ).toBe('555');
  });

  it('reads an array index via bracket notation', () => {
    expect(
      getPath({ items: [{ sku: 'A' }, { sku: 'B' }] }, 'items[1].sku')
    ).toBe('B');
  });

  it('reads a nested array index', () => {
    expect(getPath({ a: { b: ['x', 'y', 'z'] } }, 'a.b[2]')).toBe('z');
  });

  it('returns undefined for a missing key', () => {
    expect(getPath({ a: { b: 1 } }, 'a.c')).toBeUndefined();
  });

  it('returns undefined when the path runs past a primitive', () => {
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for null/undefined input', () => {
    expect(getPath(null, 'a.b')).toBeUndefined();
    expect(getPath(undefined, 'a.b')).toBeUndefined();
  });

  it('returns undefined for an empty path', () => {
    expect(getPath({ a: 1 }, '')).toBeUndefined();
  });

  it('returns undefined for an out-of-range array index', () => {
    expect(getPath({ items: ['x'] }, 'items[5]')).toBeUndefined();
  });
});
