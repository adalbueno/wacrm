-- ============================================================
-- 901_message_error_details.sql — capture why a message send failed
--
-- Design notes
--   `messages.status` has always allowed 'failed' (see the CHECK
--   constraint in 001_initial_schema.sql), but nothing ever recorded
--   *why*. Two independent code paths flip a row to 'failed':
--     1. src/lib/whatsapp/send-message.ts, when Meta's send API
--        synchronously rejects the request (bad template params,
--        Meta API error, etc).
--     2. src/app/api/whatsapp/webhook/route.ts's handleStatusUpdate,
--        when Meta's async status-callback webhook reports failure
--        for a message that was accepted and inserted as 'sent'
--        earlier (e.g. template rejected post-send, recipient
--        unreachable).
--   Both paths discarded the reason — the first by never inserting a
--   row on failure, the second by writing only the bare `status`
--   string. This mirrors the exact problem broadcast_recipients
--   already solved with its own `error_message` column (see
--   001_initial_schema.sql) — same shape, applied to direct/inbox
--   sends and their async status callbacks.
--
-- RLS
--   No policy changes. `messages` has no account_id column of its
--   own — its existing RLS policies (001_initial_schema.sql) already
--   gate every column via the owning conversation, so two new
--   nullable text columns need no additional policy work.
--
-- Idempotent — safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT;
