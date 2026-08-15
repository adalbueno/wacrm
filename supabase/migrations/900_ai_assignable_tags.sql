-- ============================================================
-- 900_ai_assignable_tags.sql — AI-assignable tags
--
-- NOTE: renamed from 031 → 900 when syncing this fork with upstream.
-- The 031 slot was already taken by upstream's 031_ai_reply_slot_grant.sql,
-- so shipping this as 031 too made a clean `supabase db` apply fail with
-- a duplicate schema_migrations key (SQLSTATE 23505). 900+ is this fork's
-- reserved band for fork-only migrations — see the "Fork-only migration
-- band" section in supabase-migrations.md — so this stops colliding with
-- upstream's own sequence for good, rather than needing a fresh renumber
-- on every future sync. This migration is idempotent
-- (ADD COLUMN IF NOT EXISTS) and independent of every upstream migration,
-- so applying it after all of them (which the 900 band guarantees) is safe.
--
-- Lets the AI auto-reply assistant (migration 029) apply an *existing*
-- tag to a contact via native provider tool-use (OpenAI function
-- calling / Anthropic tool use). The model is never allowed to create
-- a tag — only to pick from a closed enum built from tags the account
-- has explicitly opted in.
--
-- `ai_assignable` is that opt-in: only tags with this flag set are
-- exposed to the model. Keeps operational tags (vip, inadimplente,
-- newsletter-only) out of the model's reach by default.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS ai_assignable boolean NOT NULL DEFAULT false;
