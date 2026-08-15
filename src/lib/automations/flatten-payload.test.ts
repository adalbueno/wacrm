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

  it('flattens every array item — no per-array item cap, only the overall entry cap applies', () => {
    const fields = flattenPayload({
      items: Array.from({ length: 15 }, (_, i) => ({ sku: `S${i}` })),
    });
    expect(fields).toHaveLength(15);
    expect(fields[0]).toEqual({ path: 'items[0].sku', preview: 'S0' });
    expect(fields[14]).toEqual({ path: 'items[14].sku', preview: 'S14' });
  });

  // Real-world regression: a Kiwify order_approved payload nests a
  // field this deep (Subscription.charges.completed[0].card_type),
  // and the original depth-4 cap silently collapsed it to "[object]"
  // — the field picker just never showed it. See issue reported from
  // live testing of the inbound-webhook-trigger feature.
  it('reaches a field 6 levels deep, matching a real Kiwify payload shape', () => {
    const kiwifyLike = {
      Subscription: {
        charges: {
          completed: [{ card_type: 'mastercard', amount: 7541 }],
        },
      },
    };
    const fields = flattenPayload(kiwifyLike);
    expect(fields).toContainEqual({
      path: 'Subscription.charges.completed[0].card_type',
      preview: 'mastercard',
    });
    expect(fields).toContainEqual({
      path: 'Subscription.charges.completed[0].amount',
      preview: '7541',
    });
  });

  it('collapses anything past the depth cap into a placeholder preview', () => {
    // 11 levels of nesting — one past MAX_DEPTH (10).
    let deep: Record<string, unknown> = { leaf: 'too deep' };
    for (let i = 9; i >= 0; i--) {
      deep = { [`l${i}`]: deep };
    }
    const fields = flattenPayload(deep);
    expect(fields).toEqual([
      { path: 'l0.l1.l2.l3.l4.l5.l6.l7.l8.l9', preview: '[object]' },
    ]);
  });

  it('does not truncate a long preview value — callers truncate visually via CSS + a title tooltip', () => {
    const long = 'x'.repeat(100);
    const fields = flattenPayload({ note: long });
    expect(fields[0].preview).toBe(long);
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

  it('caps the total number of entries at 500', () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 600; i++) wide[`field_${i}`] = `v${i}`;
    expect(flattenPayload(wide)).toHaveLength(500);
  });
});
