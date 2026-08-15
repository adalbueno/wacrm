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

const MAX_DEPTH = 4;
const MAX_ENTRIES = 60;
const MAX_ARRAY_ITEMS = 5;
const MAX_PREVIEW_LEN = 40;

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
    for (let i = 0; i < Math.min(value.length, MAX_ARRAY_ITEMS); i++) {
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

  // Primitive leaf.
  if (path) out.push({ path, preview: preview(value) });
}

function preview(value: unknown): string {
  const s = String(value);
  return s.length > MAX_PREVIEW_LEN ? `${s.slice(0, MAX_PREVIEW_LEN)}…` : s;
}
