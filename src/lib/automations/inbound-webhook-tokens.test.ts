import { describe, expect, it } from 'vitest';
import {
  generateInboundWebhookToken,
  hashInboundWebhookToken,
  inboundWebhookUrl,
} from './inbound-webhook-tokens';

describe('generateInboundWebhookToken', () => {
  it('returns a 43-character base64url token (32 raw bytes)', () => {
    const { token } = generateInboundWebhookToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a 64-char hex hash matching SHA-256 of the token', () => {
    const { token, hash } = generateInboundWebhookToken();
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).toBe(hashInboundWebhookToken(token));
  });

  it('produces distinct tokens across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateInboundWebhookToken().token);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('hashInboundWebhookToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashInboundWebhookToken('abc')).toBe(hashInboundWebhookToken('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashInboundWebhookToken('abc')).not.toBe(
      hashInboundWebhookToken('abd')
    );
  });
});

describe('inboundWebhookUrl', () => {
  it('builds the full URL under /api/webhooks/inbound/', () => {
    expect(inboundWebhookUrl('tok123', 'https://app.example.com')).toBe(
      'https://app.example.com/api/webhooks/inbound/tok123'
    );
  });

  it('tolerates a trailing slash on baseUrl', () => {
    expect(inboundWebhookUrl('tok123', 'https://app.example.com/')).toBe(
      'https://app.example.com/api/webhooks/inbound/tok123'
    );
  });
});
