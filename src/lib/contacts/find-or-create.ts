import type { SupabaseClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';

/**
 * Find-or-create a contact by phone, shared by any inbound path that
 * receives a phone number from outside the dashboard (the WhatsApp
 * webhook, and the inbound-webhook-trigger automation route) and needs
 * to resolve it to a contact row without a human in the loop.
 *
 * Extracted from the WhatsApp webhook route (issue: needed by a second
 * caller) — behavior is unchanged, only `configOwnerUserId` was renamed
 * to `attributedUserId` since "config owner" was WhatsApp-specific.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any;

export interface ContactOutcome {
  contact: ContactRow;
  /** True when this call created the row (vs. found an existing one). */
  wasCreated: boolean;
}

export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  attributedUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  // Find an existing contact for this account by phone. The shared
  // helper pre-filters in SQL by the last-8-digit suffix (so we don't
  // pull every contact on every call) then applies the strict
  // `phonesMatch` in JS on the small candidate set. The same helper
  // backs the manual contact form and CSV import, so all callers agree
  // on what "same number" means (issue #212).
  const existingContact = await findExistingContact(db, accountId, phone);

  if (existingContact) {
    // Update name if it changed
    if (name && name !== existingContact.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id);
    }
    return { contact: existingContact, wasCreated: false };
  }

  // Create new contact. account_id is the tenancy column; user_id is
  // the NOT NULL FK audit column (no inbound event has a single "user
  // who created" it — the caller attributes it to a stable default,
  // e.g. the WhatsApp config owner or an inbound-webhook-trigger's
  // creator).
  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: attributedUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (createError) {
    // Lost a race: a concurrent call (or another path) created this
    // contact between our lookup and insert, and the unique index
    // (migration 022) rejected the duplicate. Re-resolve the existing
    // row instead of dropping the event.
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('Error creating contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}
