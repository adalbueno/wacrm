// ============================================================
// /api/automations/[id]/webhook-trigger
//
//   GET    — read the trigger's metadata (never the token).
//   POST   — create the trigger, return the URL (token embedded)
//            exactly once.
//   DELETE — revoke it.
//
// One automation has at most one inbound-webhook trigger (matches
// automations.trigger_config.webhook_trigger_id being a single value,
// not a list — see src/lib/automations/engine.ts's triggerMatches).
//
// GET is viewer+ (matches the inbound_webhook_triggers RLS select
// policy); POST/DELETE are admin+ (settings-class data, matches the
// insert/update/delete policies) — see
// supabase/migrations/902_inbound_webhook_triggers.sql.
//
// IMPORTANT: the plaintext token is returned exactly ONCE, in the
// POST response, embedded in the full URL. Only its SHA-256 hash is
// ever persisted (src/lib/automations/inbound-webhook-tokens.ts), so
// neither GET nor any other route can ever resurface it — same
// pattern as account_invitations and api_keys. If the admin loses it
// without copying, the only recourse is DELETE + POST again.
// ============================================================

import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  generateInboundWebhookToken,
  inboundWebhookUrl,
} from '@/lib/automations/inbound-webhook-tokens';
import { getBaseUrl } from '@/lib/http/base-url';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const TRIGGER_COLUMNS =
  'id, name, is_active, last_triggered_at, last_payload_sample';

async function loadOwnedAutomation(accountId: string, automationId: string) {
  const { data } = await supabaseAdmin()
    .from('automations')
    .select('id')
    .eq('id', automationId)
    .eq('account_id', accountId)
    .maybeSingle();
  return data;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const automation = await loadOwnedAutomation(ctx.accountId, id);
    if (!automation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: trigger, error } = await supabaseAdmin()
      .from('inbound_webhook_triggers')
      .select(TRIGGER_COLUMNS)
      .eq('automation_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ trigger: trigger ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    // 30/min per user — same bucket and reasoning as the invitations
    // POST route (issue #472's neighbor): this UI action is
    // clicks-only, the cap just bounds a scripted or compromised
    // session from spamming trigger rows.
    const limit = checkRateLimit(
      `admin:webhookTriggerCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const automation = await loadOwnedAutomation(ctx.accountId, id);
    if (!automation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: existing } = await supabaseAdmin()
      .from('inbound_webhook_triggers')
      .select('id')
      .eq('automation_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          error:
            'This automation already has an inbound webhook trigger. Delete it before creating a new one.',
        },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 80)
        : null;

    const { token, hash } = generateInboundWebhookToken();

    const db = supabaseAdmin();
    const { data: trigger, error: insertErr } = await db
      .from('inbound_webhook_triggers')
      .insert({
        account_id: ctx.accountId,
        automation_id: id,
        created_by: ctx.userId,
        token_hash: hash,
        name,
      })
      .select('id, created_at')
      .single();

    if (insertErr || !trigger) {
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to create webhook trigger' },
        { status: 500 }
      );
    }

    // Wire the automation to this trigger. Not a single transaction
    // with the insert above (Supabase's JS client has no cross-table
    // transaction API), but if this update fails the automation's
    // trigger_type simply stays whatever it was before — the orphaned
    // trigger row is inert (triggerMatches never sees a matching
    // webhook_trigger_id) rather than silently wrong.
    const { error: updateErr } = await db
      .from('automations')
      .update({
        trigger_type: 'inbound_webhook',
        trigger_config: { webhook_trigger_id: trigger.id },
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (updateErr) {
      console.error(
        '[webhook-trigger] failed to wire automation to new trigger:',
        updateErr
      );
      return NextResponse.json(
        { error: 'Failed to link trigger to automation' },
        { status: 500 }
      );
    }

    const url = inboundWebhookUrl(token, getBaseUrl(request));
    return NextResponse.json(
      { id: trigger.id, url, name, created_at: trigger.created_at },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    const limit = checkRateLimit(
      `admin:webhookTriggerDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const db = supabaseAdmin();
    const { data: trigger } = await db
      .from('inbound_webhook_triggers')
      .select('id')
      .eq('automation_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!trigger) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { error: deleteErr } = await db
      .from('inbound_webhook_triggers')
      .delete()
      .eq('id', trigger.id)
      .eq('account_id', ctx.accountId);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    // The automation's trigger_config.webhook_trigger_id now points at
    // nothing — triggerMatches will never match again (it compares
    // against a real inbound_webhook_triggers.id), so the automation
    // is inert. Deactivating it makes that visible in the automations
    // list instead of it silently sitting "active" and doing nothing.
    await db
      .from('automations')
      .update({ is_active: false })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('trigger_type', 'inbound_webhook');

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
