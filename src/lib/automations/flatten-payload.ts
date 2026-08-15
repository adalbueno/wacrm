/**
 * Flatten an arbitrary JSON value into a flat list of
 * `{ path, preview }` pairs — one per leaf (primitive) value — for
 * the "insert webhook field" picker in the automation builder. Every
 * `path` is exactly what `getPath` (src/lib/json-path.ts) and
 * `interpolate()`'s `{{webhook.<path>}}` placeholder expect.
 *
 * Caps depth and total entries so a large or deeply-nested sample
 * payload (a full Hotmart/Kiwify purchase event can be sizeable)
 * renders a usable dropdown instead of a wall of rows.
 */
export interface FlattenedField {
  path: string;
  /** Short display value, e.g. `"order_created"` or `"[object]"`. */
  preview: string;
}

// A real webhook payload from a platform like Kiwify or Hotmart
// routinely nests 5-6 levels deep (e.g. Subscription.charges.
// completed[0].card_type) and can carry well over 60 leaf fields —
// the original caps here (depth 4, 60 entries) were sized from a
// guess, not a real payload, and silently swallowed genuinely useful
// fields. These are generous on purpose; MAX_ENTRIES is still the
// real backstop against a pathological payload, the dropdown/preview
// containers scroll rather than grow unbounded.
const MAX_DEPTH = 10;
const MAX_ENTRIES = 500;

export function flattenPayload(value: unknown): FlattenedField[] {
  const out: FlattenedField[] = [];
  walk(value, '', 0, out);
  return out;
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  out: FlattenedField[]
): void {
  if (out.length >= MAX_ENTRIES) return;

  if (value === null || value === undefined) {
    if (path) out.push({ path, preview: 'null' });
    return;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      out.push({ path, preview: `[${value.length} items]` });
      return;
    }
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${path}[${i}]`, depth + 1, out);
      if (out.length >= MAX_ENTRIES) return;
    }
    return;
  }

  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) {
      out.push({ path, preview: '[object]' });
      return;
    }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, path ? `${path}.${key}` : key, depth + 1, out);
      if (out.length >= MAX_ENTRIES) return;
    }
    return;
  }

  // Primitive leaf. Full value, untruncated — callers that render this
  // in constrained space (the field picker, the trigger panel's
  // payload preview) truncate visually with CSS and rely on a `title`
  // attribute to show the whole thing on hover, so truncating the
  // string itself here would just make that tooltip useless too.
  if (path) out.push({ path, preview: String(value) });
}
