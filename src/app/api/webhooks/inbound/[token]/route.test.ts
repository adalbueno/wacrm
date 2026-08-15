import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { hashInboundWebhookToken } from '@/lib/automations/inbound-webhook-tokens';

const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
  state: {
    afterCallbacks: [] as (() => Promise<void> | void)[],
    trigger: null as {
      id: string;
      account_id: string;
      automation_id: string;
      created_by: string | null;
    } | null,
    lookupError: null as { message: string } | null,
    updateCalls: [] as { row: Record<string, unknown>; id: string }[],
    eqCalls: [] as [string, unknown][],
  },
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'inbound_webhook_triggers')
        throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            h.state.eqCalls.push([col, val]);
            return {
              eq: (col2: string, val2: unknown) => {
                h.state.eqCalls.push([col2, val2]);
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: h.state.trigger,
                      error: h.state.lookupError,
                    }),
                };
              },
            };
          },
        }),
        update: (row: Record<string, unknown>) => ({
          eq: (_: string, id: string) => {
            h.state.updateCalls.push({ row, id });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  }),
}));

import { POST } from './route';

const TOKEN = 'plaintext-token-abc';
const TOKEN_HASH = hashInboundWebhookToken(TOKEN);

function post(body: unknown, token = TOKEN) {
  const request = new Request(
    `http://localhost/api/webhooks/inbound/${token}`,
    {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  );
  return POST(request, {
    params: Promise.resolve({ token }),
  }) as unknown as Promise<{
    body: unknown;
    init?: { status?: number };
  }>;
}

async function flushAfter() {
  for (const cb of h.state.afterCallbacks) await cb();
  h.state.afterCallbacks = [];
}

beforeEach(() => {
  __resetRateLimitForTests();
  h.runAutomationsForTrigger.mockClear();
  h.state.trigger = null;
  h.state.lookupError = null;
  h.state.updateCalls = [];
  h.state.afterCallbacks = [];
  h.state.eqCalls = [];
});

describe('POST /api/webhooks/inbound/[token]', () => {
  it('returns 404 for an unknown token', async () => {
    h.state.trigger = null;
    const res = await post({ event: 'x' });
    expect(res.init?.status).toBe(404);
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    h.state.trigger = {
      id: 'wh1',
      account_id: 'acct-1',
      automation_id: 'a1',
      created_by: 'u1',
    };
    const res = await post('not json {{{');
    expect(res.init?.status).toBe(400);
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('accepts a valid request and dispatches the automation after responding', async () => {
    h.state.trigger = {
      id: 'wh1',
      account_id: 'acct-1',
      automation_id: 'a1',
      created_by: 'u1',
    };
    const payload = { event: 'purchase', contact: { phone: '+15551234567' } };

    const res = await post(payload);

    expect(res.init?.status).toBe(202);
    expect(res.body).toEqual({ status: 'accepted' });
    // Dispatch happens inside after(), not before the response.
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();

    await flushAfter();

    expect(h.runAutomationsForTrigger).toHaveBeenCalledWith({
      accountId: 'acct-1',
      triggerType: 'inbound_webhook',
      contactId: null,
      context: { webhook_payload: payload, webhookTriggerId: 'wh1' },
    });
    expect(h.state.updateCalls).toHaveLength(1);
    expect(h.state.updateCalls[0].id).toBe('wh1');
    expect(
      (h.state.updateCalls[0].row as { last_payload_sample: unknown })
        .last_payload_sample
    ).toEqual(payload);
  });

  it('returns 429 once the per-token rate limit is exceeded', async () => {
    h.state.trigger = {
      id: 'wh1',
      account_id: 'acct-1',
      automation_id: 'a1',
      created_by: 'u1',
    };
    // RATE_LIMITS.inboundWebhookTrigger is 60/min — exhaust it.
    for (let i = 0; i < 60; i++) {
      const res = await post({ i });
      expect(res.init?.status ?? 202).not.toBe(429);
    }
    const res = await post({ over: true });
    expect(res.init?.status).toBe(429);
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('looks up by the SHA-256 hash of the token, never the plaintext, and filters is_active', async () => {
    h.state.trigger = {
      id: 'wh1',
      account_id: 'acct-1',
      automation_id: 'a1',
      created_by: 'u1',
    };
    await post({ event: 'x' });

    expect(h.state.eqCalls).toContainEqual(['token_hash', TOKEN_HASH]);
    expect(h.state.eqCalls).toContainEqual(['is_active', true]);
    expect(h.state.eqCalls.flat()).not.toContain(TOKEN);
  });
});
