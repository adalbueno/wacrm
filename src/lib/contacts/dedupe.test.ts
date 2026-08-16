import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the .from().select().eq().like()
  // chain to a fixed candidate set, and records which column .like() was
  // called against so tests can assert on it directly.
  function stubDb(rows: Array<{ id: string; phone: string }>) {
    const likeCalls: [string, string][] = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: (column: string, pattern: string) => {
        likeCalls.push([column, pattern]);
        return Promise.resolve({ data: rows, error: null });
      },
    };
    const db = { from: () => builder } as unknown as SupabaseClient;
    return { db, likeCalls };
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const { db } = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
  });

  it("returns null when no candidate matches", async () => {
    const { db } = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const { db } = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ")).toBeNull();
  });

  // Regression: the SQL pre-filter must target phone_normalized (the
  // digits-only generated column, migration 022), never the raw phone
  // column. A contact whose raw `phone` still carries punctuation
  // (e.g. "+55 (11) 91234-5678", stored exactly as typed by the manual
  // contact form) has a raw-column tail that doesn't end in 8 bare
  // digits, so a real Postgres LIKE '%12345678' against `phone` would
  // silently miss it even though `phone_normalized` — and the DB's own
  // unique index — agree it's the same number. This stub can't
  // reproduce Postgres LIKE semantics, but it can assert the fix at
  // the one place that matters: which column the query actually names.
  it("pre-filters against phone_normalized, not the raw phone column", async () => {
    const { db, likeCalls } = stubDb([
      { id: "c1", phone: "+55 (11) 91234-5678" },
    ]);
    await findExistingContact(db, "acct", "5511912345678");
    expect(likeCalls).toHaveLength(1);
    expect(likeCalls[0][0]).toBe("phone_normalized");
  });
});
