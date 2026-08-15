// ============================================================
// Inbound webhook trigger token utilities — pure, server-side, no
// Supabase. Mirrors src/lib/auth/invitations.ts exactly (same
// entropy, same hash-at-rest reasoning): the DB stores only
// `inbound_webhook_triggers.token_hash`, never the plaintext. The
// plaintext is shown to the creator exactly once, embedded directly
// in the webhook URL the external system (Hotmart, Kiwify, a custom
// backend, ...) is configured to POST to — see
// supabase/migrations/902_inbound_webhook_triggers.sql for why this
// is the URL-token model rather than a bearer-key header.
// ============================================================

import { createHash, randomBytes } from 'node:crypto';

export interface GeneratedInboundWebhookToken {
  /** Plaintext token — return to the creator ONCE, never persist. */
  token: string;
  /** SHA-256 hex digest of the token. Persist this in the DB. */
  hash: string;
}

/**
 * Generate a fresh inbound-webhook-trigger token + its hash. Call
 * once per trigger creation; the plaintext becomes part of the
 * webhook URL shown in the UI, the hash is stored in
 * `inbound_webhook_triggers.token_hash`.
 */
export function generateInboundWebhookToken(): GeneratedInboundWebhookToken {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInboundWebhookToken(token) };
}

/**
 * Deterministic SHA-256 of a plaintext token. Used on every inbound
 * POST to look up the matching `inbound_webhook_triggers` row by
 * `token_hash`. Pure function — same input always produces the same
 * output.
 */
export function hashInboundWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Build the full webhook URL to hand the external system.
 * `baseUrl` must NOT have a trailing slash. Tolerates one anyway
 * (callers typically pass `NEXT_PUBLIC_APP_URL` verbatim).
 */
export function inboundWebhookUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/api/webhooks/inbound/${token}`;
}
