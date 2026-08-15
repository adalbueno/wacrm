// ============================================================
// POST /api/webhooks/inbound/[token]
//
// Public — no dashboard session, no API-key bearer. Auth is the
// high-entropy token embedded in the URL path itself (see
// src/lib/automations/inbound-webhook-tokens.ts and
// supabase/migrations/902_inbound_webhook_triggers.sql for the full
// rationale): none of the real-world senders this targets (Hotmart,
// Kiwify, a generic no-code tool) let the account holder configure a
// custom Authorization header on their webhook settings screen — they
// only accept a URL to POST to. One token maps to exactly one
// Automation.
//
// This route deliberately does NOT validate the request body's shape
// beyond "is it JSON" — the sender's payload shape is out of wacrm's
// control, so it's handed to the automation engine as-is
// (context.webhook_payload) and an automation resolves whatever it
// needs via {{webhook.*}} interpolation / the webhook_field condition
// / the find_or_create_contact step (see src/lib/automations/engine.ts).
//
// Rate limiting is per-token (RATE_LIMITS.inboundWebhookTrigger), not
// per-IP — the token IS the tenant identity here, there's no other
// caller identity to key off.
// ============================================================

import { NextResponse, after } from 'next/server';
import { hashInboundWebhookToken } from '@/lib/automations/inbound-webhook-tokens';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { supabaseAdmin } from '@/lib/automations/admin-client';

// Mirrors the WhatsApp webhook route's use of `after()`: senders like
// Hotmart/Kiwify expect a fast 2xx and don't wait on processing, and a
// detached promise isn't guaranteed to finish on a serverless runtime
// once the response has been sent (see that route's comment, issue
// #301). `after()` keeps the function alive until the automation run
// actually completes, within this budget.
export const maxDuration = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const tokenHash = hashInboundWebhookToken(token);

  // Rate-limit before the DB lookup, same ordering rationale as the
  // public API's requireApiKey: don't let a caller (valid token or
  // not) spend a DB round trip past the budget.
  const limit = checkRateLimit(
    `inbound-webhook:${tokenHash}`,
    RATE_LIMITS.inboundWebhookTrigger
  );
  if (!limit.success) return rateLimitResponse(limit);

  const db = supabaseAdmin();
  const { data: trigger, error } = await db
    .from('inbound_webhook_triggers')
    .select('id, account_id, automation_id, created_by')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[inbound-webhook] trigger lookup failed:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  // Unknown token and inactive token get the same generic 404 —
  // distinguishing them would tell a prober which guesses are "close."
  if (!trigger) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  after(async () => {
    try {
      // Fire-and-forget bookkeeping, in parallel with dispatch — a slow
      // or failed update here shouldn't delay or block the automation
      // run. last_payload_sample is a UI convenience only (lets the
      // automation builder show real field names), never a gate.
      const bookkeeping = db
        .from('inbound_webhook_triggers')
        .update({
          last_payload_sample: payload,
          last_triggered_at: new Date().toISOString(),
        })
        .eq('id', trigger.id)
        .then(({ error: updateErr }) => {
          if (updateErr) {
            console.warn(
              '[inbound-webhook] bookkeeping update failed:',
              updateErr.message
            );
          }
        });

      const dispatch = runAutomationsForTrigger({
        accountId: trigger.account_id,
        triggerType: 'inbound_webhook',
        contactId: null,
        context: {
          webhook_payload: payload,
          webhookTriggerId: trigger.id,
        },
      });

      await Promise.all([bookkeeping, dispatch]);
    } catch (err) {
      // runAutomationsForTrigger already never throws, but this stays
      // defensive since it's the last line of defense on a background
      // callback with no caller left to report to.
      console.error('[inbound-webhook] processing failed:', err);
    }
  });

  return NextResponse.json({ status: 'accepted' }, { status: 202 });
}
