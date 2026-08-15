import { describe, expect, it } from 'vitest';
import { flattenPayload } from './flatten-payload';

describe('flattenPayload', () => {
  it('flattens a nested object into dot paths', () => {
    const fields = flattenPayload({
      data: { buyer: { name: 'Ada', phone: '555' } },
    });
    expect(fields).toEqual([
      { path: 'data.buyer.name', preview: 'Ada' },
      { path: 'data.buyer.phone', preview: '555' },
    ]);
  });

  it('flattens array items with bracket-index paths, capped at 5 items', () => {
    const fields = flattenPayload({
      items: Array.from({ length: 8 }, (_, i) => ({ sku: `S${i}` })),
    });
    expect(fields).toHaveLength(5);
    expect(fields[0]).toEqual({ path: 'items[0].sku', preview: 'S0' });
    expect(fields[4]).toEqual({ path: 'items[4].sku', preview: 'S4' });
  });

  it('collapses anything past the depth cap into a placeholder preview', () => {
    const deep = { a: { b: { c: { d: { e: 'too deep' } } } } };
    const fields = flattenPayload(deep);
    expect(fields).toEqual([{ path: 'a.b.c.d', preview: '[object]' }]);
  });

  it('truncates a long preview value', () => {
    const fields = flattenPayload({ note: 'x'.repeat(100) });
    expect(fields[0].preview.endsWith('…')).toBe(true);
    expect(fields[0].preview.length).toBe(41); // 40 chars + ellipsis
  });

  it('renders null/undefined leaves as "null"', () => {
    expect(flattenPayload({ a: null, b: undefined })).toEqual([
      { path: 'a', preview: 'null' },
      { path: 'b', preview: 'null' },
    ]);
  });

  it('returns an empty list for a bare primitive or empty object', () => {
    expect(flattenPayload('just a string')).toEqual([]);
    expect(flattenPayload({})).toEqual([]);
  });

  it('caps the total number of entries at 60', () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 100; i++) wide[`field_${i}`] = `v${i}`;
    expect(flattenPayload(wide)).toHaveLength(60);
  });
});
