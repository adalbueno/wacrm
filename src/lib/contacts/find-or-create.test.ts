import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockFindExistingContact = vi.fn();
const mockIsUniqueViolation = vi.fn();

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: (...args: unknown[]) => mockFindExistingContact(...args),
  isUniqueViolation: (...args: unknown[]) => mockIsUniqueViolation(...args),
}));

import { findOrCreateContact } from './find-or-create';

/** Minimal SupabaseClient stub covering the `contacts` update/insert
 *  chains `findOrCreateContact` uses directly (lookup goes through the
 *  mocked `findExistingContact` above, not this stub). */
function stubDb(opts: {
  update?: () => void;
  insertResult?: { data: unknown; error: unknown };
}): SupabaseClient {
  const updateBuilder = {
    eq: () => {
      opts.update?.();
      return Promise.resolve({ data: null, error: null });
    },
  };
  const insertBuilder = {
    select: () => ({
      single: () =>
        Promise.resolve(opts.insertResult ?? { data: null, error: null }),
    }),
  };
  return {
    from: () => ({
      update: () => updateBuilder,
      insert: () => insertBuilder,
    }),
  } as unknown as SupabaseClient;
}

describe('findOrCreateContact', () => {
  beforeEach(() => {
    mockFindExistingContact.mockReset();
    mockIsUniqueViolation.mockReset();
  });

  it('returns the existing contact without updating when the name is unchanged', async () => {
    mockFindExistingContact.mockResolvedValueOnce({
      id: 'c1',
      phone: '15551230000',
      name: 'Ada',
    });
    const update = vi.fn();
    const db = stubDb({ update });

    const result = await findOrCreateContact(
      db,
      'acct-1',
      'user-1',
      '15551230000',
      'Ada'
    );

    expect(result).toEqual({
      contact: { id: 'c1', phone: '15551230000', name: 'Ada' },
      wasCreated: false,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('updates the name on an existing contact when it changed', async () => {
    mockFindExistingContact.mockResolvedValueOnce({
      id: 'c1',
      phone: '15551230000',
      name: 'Old Name',
    });
    const update = vi.fn();
    const db = stubDb({ update });

    const result = await findOrCreateContact(
      db,
      'acct-1',
      'user-1',
      '15551230000',
      'New Name'
    );

    expect(result?.wasCreated).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('creates a new contact when none exists', async () => {
    mockFindExistingContact.mockResolvedValueOnce(null);
    const newContact = { id: 'c2', phone: '15559990000', name: 'Grace' };
    const db = stubDb({ insertResult: { data: newContact, error: null } });

    const result = await findOrCreateContact(
      db,
      'acct-1',
      'user-1',
      '15559990000',
      'Grace'
    );

    expect(result).toEqual({ contact: newContact, wasCreated: true });
  });

  it('falls back to the phone number as the name when name is empty', async () => {
    mockFindExistingContact.mockResolvedValueOnce(null);
    let insertedName: string | undefined;
    const insertBuilder = {
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: 'c3', phone: '15551110000', name: insertedName },
            error: null,
          }),
      }),
    };
    const db = {
      from: () => ({
        insert: (row: { name: string }) => {
          insertedName = row.name;
          return insertBuilder;
        },
      }),
    } as unknown as SupabaseClient;

    await findOrCreateContact(db, 'acct-1', 'user-1', '15551110000', '');

    expect(insertedName).toBe('15551110000');
  });

  it('re-resolves the winning row on a race (unique violation on insert)', async () => {
    mockFindExistingContact
      .mockResolvedValueOnce(null) // initial lookup: nothing yet
      .mockResolvedValueOnce({ id: 'c4', phone: '15552220000', name: 'Racer' }); // re-resolve after race
    mockIsUniqueViolation.mockReturnValueOnce(true);
    const db = stubDb({
      insertResult: { data: null, error: { code: '23505' } },
    });

    const result = await findOrCreateContact(
      db,
      'acct-1',
      'user-1',
      '15552220000',
      'Racer'
    );

    expect(result).toEqual({
      contact: { id: 'c4', phone: '15552220000', name: 'Racer' },
      wasCreated: false,
    });
    expect(mockFindExistingContact).toHaveBeenCalledTimes(2);
  });

  it('returns null on a non-unique-violation insert error', async () => {
    mockFindExistingContact.mockResolvedValueOnce(null);
    mockIsUniqueViolation.mockReturnValueOnce(false);
    const db = stubDb({
      insertResult: { data: null, error: { code: 'unexpected' } },
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await findOrCreateContact(
      db,
      'acct-1',
      'user-1',
      '15553330000',
      'Nobody'
    );

    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });
});
