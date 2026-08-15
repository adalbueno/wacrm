import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  state: {
    automation: null as { id: string } | null,
    trigger: null as {
      id: string;
      name: string | null;
      is_active: boolean;
      last_triggered_at: string | null;
      last_payload_sample: unknown;
    } | null,
    insertedTrigger: {
      id: 'new-trigger-1',
      created_at: '2026-01-01T00:00:00Z',
    },
    insertCalls: [] as Record<string, unknown>[],
    automationUpdateCalls: [] as Record<string, unknown>[],
    triggerDeleteCalls: [] as string[],
  },
}));

const ctx = {
  supabase: {},
  accountId: 'acct-1',
  userId: 'user-1',
  role: 'admin',
  account: { id: 'acct-1', name: 'Acme' },
};

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 403 }
    ),
}));

vi.mock('@/lib/automations/inbound-webhook-tokens', () => ({
  generateInboundWebhookToken: () => ({
    token: 'plaintext-token-xyz',
    hash: 'hash-xyz',
  }),
  inboundWebhookUrl: (token: string, baseUrl: string) =>
    `${baseUrl.replace(/\/+$/, '')}/api/webhooks/inbound/${token}`,
}));

vi.mock('@/lib/http/base-url', () => ({
  getBaseUrl: () => 'https://app.example.com',
}));

/** A chainable node that also resolves like a Promise — supports any
 *  number of `.eq()` calls before being awaited, matching how
 *  Supabase's real query builder is thenable at every step. */
function thenableChain<T>(resolve: () => T | Promise<T>) {
  const node = {
    eq: () => node,
    then: (onF: (v: T) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR),
  };
  return node;
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: h.state.automation, error: null }),
              }),
            }),
          }),
          update: (row: Record<string, unknown>) =>
            thenableChain(() => {
              h.state.automationUpdateCalls.push(row);
              return { error: null };
            }),
        };
      }
      if (table === 'inbound_webhook_triggers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: h.state.trigger, error: null }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            h.state.insertCalls.push(row);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: h.state.insertedTrigger,
                    error: null,
                  }),
              }),
            };
          },
          delete: () =>
            thenableChain(() => {
              if (h.state.trigger)
                h.state.triggerDeleteCalls.push(h.state.trigger.id);
              return { error: null };
            }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { GET, POST, DELETE } from './route';

const params = { params: Promise.resolve({ id: 'auto-1' }) };

function post(body: unknown = {}) {
  return POST(
    new Request('http://localhost/api/automations/auto-1/webhook-trigger', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params
  );
}

function del() {
  return DELETE(
    new Request('http://localhost/api/automations/auto-1/webhook-trigger', {
      method: 'DELETE',
    }),
    params
  );
}

beforeEach(() => {
  __resetRateLimitForTests();
  h.getCurrentAccount.mockReset().mockResolvedValue(ctx);
  h.requireRole.mockReset().mockResolvedValue(ctx);
  h.state.automation = { id: 'auto-1' };
  h.state.trigger = null;
  h.state.insertCalls = [];
  h.state.automationUpdateCalls = [];
  h.state.triggerDeleteCalls = [];
});

describe('GET /api/automations/[id]/webhook-trigger', () => {
  it('404s when the automation is not owned by the account', async () => {
    h.state.automation = null;
    const res = await GET(new Request('http://localhost'), params);
    expect(res.status).toBe(404);
  });

  it('returns trigger: null when none exists', async () => {
    h.state.trigger = null;
    const res = await GET(new Request('http://localhost'), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trigger: null });
  });

  it('returns the trigger metadata without ever including a token', async () => {
    h.state.trigger = {
      id: 'wh1',
      name: 'New purchase',
      is_active: true,
      last_triggered_at: null,
      last_payload_sample: null,
    };
    const res = await GET(new Request('http://localhost'), params);
    const body = await res.json();
    expect(body.trigger).toMatchObject({ id: 'wh1', name: 'New purchase' });
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });
});

describe('POST /api/automations/[id]/webhook-trigger', () => {
  it('requires admin', async () => {
    await post();
    expect(h.requireRole).toHaveBeenCalledWith('admin');
  });

  it('404s when the automation is not owned by the account', async () => {
    h.state.automation = null;
    const res = await post();
    expect(res.status).toBe(404);
  });

  it('409s when a trigger already exists for this automation', async () => {
    h.state.trigger = {
      id: 'wh1',
      name: null,
      is_active: true,
      last_triggered_at: null,
      last_payload_sample: null,
    };
    const res = await post();
    expect(res.status).toBe(409);
    expect(h.state.insertCalls).toHaveLength(0);
  });

  it('creates the trigger, wires the automation, and returns the URL with the token exactly once', async () => {
    const res = await post({ name: 'New purchase' });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.url).toBe(
      'https://app.example.com/api/webhooks/inbound/plaintext-token-xyz'
    );
    expect(body.id).toBe('new-trigger-1');

    expect(h.state.insertCalls).toHaveLength(1);
    expect(h.state.insertCalls[0]).toMatchObject({
      account_id: 'acct-1',
      automation_id: 'auto-1',
      created_by: 'user-1',
      token_hash: 'hash-xyz',
      name: 'New purchase',
    });
    // The insert payload must never carry the plaintext token.
    expect(JSON.stringify(h.state.insertCalls[0])).not.toContain(
      'plaintext-token-xyz'
    );

    expect(h.state.automationUpdateCalls).toHaveLength(1);
    expect(h.state.automationUpdateCalls[0]).toEqual({
      trigger_type: 'inbound_webhook',
      trigger_config: { webhook_trigger_id: 'new-trigger-1' },
    });
  });

  it('returns 429 once the admin-action rate limit is exceeded', async () => {
    for (let i = 0; i < 30; i++) {
      h.state.trigger = null;
      const res = await post();
      expect(res.status).not.toBe(429);
    }
    h.state.trigger = null;
    const res = await post();
    expect(res.status).toBe(429);
  });
});

describe('DELETE /api/automations/[id]/webhook-trigger', () => {
  it('requires admin', async () => {
    h.state.trigger = {
      id: 'wh1',
      name: null,
      is_active: true,
      last_triggered_at: null,
      last_payload_sample: null,
    };
    await del();
    expect(h.requireRole).toHaveBeenCalledWith('admin');
  });

  it('404s when there is no trigger to delete', async () => {
    h.state.trigger = null;
    const res = await del();
    expect(res.status).toBe(404);
  });

  it('deletes the trigger and deactivates the automation', async () => {
    h.state.trigger = {
      id: 'wh1',
      name: null,
      is_active: true,
      last_triggered_at: null,
      last_payload_sample: null,
    };
    const res = await del();
    expect(res.status).toBe(200);
    expect(h.state.triggerDeleteCalls).toEqual(['wh1']);
    expect(h.state.automationUpdateCalls).toContainEqual({ is_active: false });
  });
});
