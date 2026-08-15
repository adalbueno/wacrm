-- ============================================================
-- 902_inbound_webhook_triggers.sql — Inbound webhook trigger for Automations
--
-- Lets an external system (a course/checkout platform like Hotmart or
-- Kiwify, a custom store, Zapier/n8n, ...) POST an event to wacrm and
-- have it run a specific Automation. This is the "push in" counterpart
-- to `webhook_endpoints` (028) and the public API's `POST /messages` —
-- neither of those lets an outside system *start* something in wacrm.
--
-- Design notes
--   - One row per Automation that opts into this trigger, not a single
--     account-wide endpoint routed by an event name — mirrors how the
--     automation engine already dispatches by `trigger_type`, and
--     matches the n8n/Zapier per-workflow webhook URL model. Real FK to
--     `automations`, not a polymorphic target — Flow support is
--     deliberately deferred (a flow run structurally requires a
--     contact+conversation to already exist before it can start, so
--     "maybe create a contact from webhook data" doesn't fit there
--     without deeper engine changes).
--   - Auth model is deliberately a THIRD mechanism alongside the
--     dashboard's cookie session and the public API's bearer key (see
--     `.claude/rules/security.md`, confirmed with the user before
--     building): a high-entropy token embedded directly in the webhook
--     URL. Only its SHA-256 hash is stored, same reasoning as
--     `account_invitations.token_hash` and `api_keys.key_hash` — the
--     token is never re-derivable, only re-comparable. This shape was
--     chosen (over a bearer-key header) because none of the real-world
--     senders this targets (Hotmart, Kiwify, generic no-code tools) let
--     you configure a custom `Authorization` header on their webhook
--     config screen — they only accept a URL to POST to.
--   - No fixed payload contract and no field-mapping table here: the
--     automation engine receives the raw JSON body as
--     `context.webhook_payload` and an automation resolves/creates a
--     contact via an explicit `find_or_create_contact` step (added in
--     app code, not this migration), referencing payload fields as
--     `{{webhook.some.path}}`. `last_payload_sample` exists purely so
--     the automation builder UI can show real field names while the
--     user is wiring up a step or condition — it is not a gate; a
--     trigger dispatches from the moment it's created.
--   - `automations.trigger_config` gets a `webhook_trigger_id` pointing
--     back at this row's `id` (set by application code when the row is
--     created) so the engine's trigger-type fan-out can be narrowed to
--     the one matching automation instead of firing every
--     `inbound_webhook`-typed automation on every request.
--
-- RLS
--   Settings-class, same tier as `webhook_endpoints`/`api_keys`: any
--   member (viewer+) can see the roster (URL itself is never re-exposed
--   after creation — only the app layer withholds the plaintext token,
--   RLS just gates the row); only admin+ may create/update/delete.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS inbound_webhook_triggers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  automation_id      uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name               text,                      -- optional label, e.g. "New purchase"
  token_hash         text NOT NULL UNIQUE,       -- SHA-256 hex of the URL token; plaintext shown once at creation
  is_active          boolean NOT NULL DEFAULT true,
  last_payload_sample jsonb,                     -- last raw body received; UI convenience only, not a gate
  last_triggered_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_webhook_triggers_account_id_idx
  ON inbound_webhook_triggers (account_id);

CREATE INDEX IF NOT EXISTS inbound_webhook_triggers_automation_id_idx
  ON inbound_webhook_triggers (automation_id);

-- The inbound route looks up by token_hash on every request; UNIQUE
-- above already implies an index, but a dedicated name matches this
-- repo's convention of always naming lookup indexes explicitly.
CREATE INDEX IF NOT EXISTS inbound_webhook_triggers_token_hash_idx
  ON inbound_webhook_triggers (token_hash);

ALTER TABLE inbound_webhook_triggers ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the roster.
DROP POLICY IF EXISTS inbound_webhook_triggers_select ON inbound_webhook_triggers;
CREATE POLICY inbound_webhook_triggers_select ON inbound_webhook_triggers FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class, mirrors webhook_endpoints).
DROP POLICY IF EXISTS inbound_webhook_triggers_insert ON inbound_webhook_triggers;
CREATE POLICY inbound_webhook_triggers_insert ON inbound_webhook_triggers FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS inbound_webhook_triggers_update ON inbound_webhook_triggers;
CREATE POLICY inbound_webhook_triggers_update ON inbound_webhook_triggers FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS inbound_webhook_triggers_delete ON inbound_webhook_triggers;
CREATE POLICY inbound_webhook_triggers_delete ON inbound_webhook_triggers FOR DELETE
  USING (is_account_member(account_id, 'admin'));
