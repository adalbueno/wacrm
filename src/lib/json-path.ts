/**
 * Read a value out of an arbitrary JSON-shaped object by dot/bracket
 * path (e.g. `"data.buyer.checkout_phone"`, `"items[0].sku"`). No
 * `eval`/`Function` — pure property lookups, safe on payloads from an
 * untrusted external sender (the inbound-webhook-trigger automation
 * route, `{{webhook.*}}` interpolation).
 *
 * Array indices work because `obj['0']` reads the same slot as
 * `obj[0]` in JS — bracket segments are tokenized identically to dot
 * segments, no special-casing needed.
 */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const tokens = path.match(/[^.[\]]+/g);
  if (!tokens) return undefined;

  let current: unknown = obj;
  for (const token of tokens) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}
