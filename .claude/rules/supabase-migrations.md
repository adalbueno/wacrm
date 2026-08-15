# Supabase Migrations

Scope: `supabase/migrations/*.sql`

## Numbering

Files are `NNN_description.sql`, zero-padded to 3 digits, strictly increasing, one migration ahead of the current highest number. Check the current max before creating a new one:

```bash
ls supabase/migrations | sort | tail -1
```

Never renumber or edit an already-merged migration — a migration that already ran in some deployment is immutable. If a merged migration was wrong, write a new migration that corrects it.

### Fork-only migration band (900+)

This fork and `upstream` (`ArnasDon/wacrm`) each pick "current max + 1" independently, so a migration written on this fork's `main` and one written on upstream's `main` can end up claiming the same number — checking the local max before writing a migration doesn't see numbers upstream added after that point. A collision like this fails a clean `supabase db reset` with a duplicate `schema_migrations` key (SQLSTATE 23505); upstream has hit this internally too (see the note at the top of `034_fix_profiles_update_rls.sql`).

**Every migration written in this fork (not inherited from upstream) uses `9NN_description.sql`, starting at `900`.** Upstream's own sequence is at `039` as of the last sync and moves slowly (a handful of schema migrations across hundreds of merged PRs) — reaching `900` would take it many decades at the current pace, so this reserves a band upstream will not realistically reach. Concretely:

- Check the current max **within the 900+ band specifically** when writing a new fork migration — `ls supabase/migrations | sort | tail -1` still works unmodified for this, since any `9NN` file always sorts after any `0NN`/`1NN`/... file, so the last file overall is always the fork's own last one (as long as upstream stays under 900).
- A migration inherited from an `upstream/main` merge keeps upstream's own number (`0NN`), even if it lands after fork migrations chronologically — never renumber an upstream file.
- Applying order follows filename sort, so `9NN` fork migrations always run *after every* upstream migration, present and future. Treat this as the intended model — "upstream's base schema, then this fork's customizations layered on top" — not an ordering quirk: it means a fork migration can safely assume anything upstream ever ships, and upstream can never accidentally depend on something only this fork has. Keep fork migrations self-contained (idempotent `IF NOT EXISTS` guards, no dependency on exactly *which* upstream migrations have run) so this ordering never actually matters in practice.
- **Early-warning signal**: if `upstream/main`'s own migrations ever climb past roughly `800`, that's the cue to widen the reserved band (e.g. shift new fork migrations to `9000+`) *before* a collision happens, not after.

### If a collision happens anyway

The 900+ band makes a fork/upstream collision very unlikely, not impossible (upstream could theoretically also adopt a 900+-style band, or some other unforeseen numbering choice). If it does happen — including the one-time case of migrating already-numbered files into the reserved band, as this fork did on first adopting it:

1. Identify which of the colliding files is this fork's own (not upstream's) — upstream's file keeps its number, since it may already be applied in other forks/deployments of the template.
2. Rename this fork's file into (or further along within) the 900+ band, past the current fork-only max.
3. Add a one-line note at the top of the renamed file's header explaining the rename (old number, why) and confirming — don't just assert — that it's independent of whatever migrations now sit between the old and new slot.
4. Verify with an actual local replay before considering the fix done — `supabase db reset --local --no-seed` followed by `supabase db query --local --file supabase/ci/verify-schema.sql` (matches what `.github/workflows/migrations.yml` runs). Don't rely on `supabase db start` alone; it's a no-op against a database that already exists and won't catch this.
5. This is a fix, not part of the sync merge itself — it goes on its own branch/PR (see `AGENTS.md`'s Git Workflow section), not a direct commit to `main`.

**If this fork's migration was already applied to a real deployed Supabase project under the old number**, the file rename alone does not fix that project — and doing nothing further leaves a silent, dangerous gap, not just cosmetic drift. Supabase's CLI decides what to apply by comparing each local file's version number against `supabase_migrations.schema_migrations` on the target database — it does not compare content. Concretely, after this fork's original `031_ai_assignable_tags.sql` had already been pushed to a real project (recording a row for version `031`), merging upstream introduced a *different* migration also named `031` (`031_ai_reply_slot_grant.sql`). Left alone, the next `supabase db push` against that project would see version `031` already marked applied and silently skip upstream's real `031` migration entirely — even though it does something unrelated and often important (in this exact case, granting `service_role` the EXECUTE privilege AI auto-reply's `claim_ai_reply_slot()` needs; without it, auto-reply fails permission-denied and never sends a single reply, silently). This is a correctness bug on the live project, not just messy bookkeeping, so treat it as required cleanup, not optional:

1. On the affected project's database (Supabase Studio SQL editor, or `psql`/`supabase db push` against it — never guess; connect and check), confirm what's actually recorded: `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '<old number>';` and confirm the underlying schema change genuinely already happened (e.g. `SELECT column_name FROM information_schema.columns WHERE table_name = '<table>' AND column_name = '<column>';` for a column-adding migration like this one).
2. Delete only that stale row: `DELETE FROM supabase_migrations.schema_migrations WHERE version = '<old number>';` — this table is pure CLI bookkeeping (what's been applied), not application data; removing one row has no cascading effect beyond what the next push applies.
3. Run the normal deploy path (`supabase db push` or equivalent) against that project. The CLI will now correctly apply the real migration that owns the old number (safe — every migration in this repo is idempotency-guarded per the rule above) and re-run the renamed fork migration under its new number (also a safe no-op, since its effect is already present).
4. Do this for every real deployment that had the fork's migration applied under the old number before the rename — not just one. This is a per-database fix; renaming the file does nothing for a database until this runs against it.

## Idempotency — every migration must be safe to run twice

Postgres has no `CREATE POLICY IF NOT EXISTS`, so the pattern throughout this repo is:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- For anything without an `IF NOT EXISTS` form (policies, triggers, some functions): `DROP ... IF EXISTS` immediately before the `CREATE`
- `CREATE OR REPLACE FUNCTION` for functions

Follow this even when you're confident the migration will only ever run once — it's load-bearing for re-applying migrations against a fresh Supabase project.

## Header comment block

Every migration opens with a `-- ====...` banner comment: filename + one-line summary, then prose sections as needed — "Design notes" (why this shape, not just what), "RLS" (policy summary in words), "What this migration does NOT touch" for anything non-obvious it deliberately leaves alone, and always closing with the idempotency note. See `017_account_sharing.sql` or `026_api_keys.sql` for the calibration — this is prose that explains a decision, not a changelog of the SQL below it.

## RLS is mandatory on every new table

1. `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` immediately after creating the table.
2. Every account-owned table gets an `account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` column and an index on it.
3. Policies are gated through the `is_account_member(account_id, min_role)` SECURITY DEFINER helper (defined in `017_account_sharing.sql`), never a raw `auth.uid() = user_id` check — that pattern is legacy and pre-dates multi-tenancy.
   - Default role tiers used across the codebase: **viewer+** can `SELECT` operational data; **agent+** can write operational data (contacts, messages, deals); **admin+** can write settings-class data (tags, custom fields, API keys, webhooks). Match the tier to the table's blast radius, not to what's convenient.
4. `DROP POLICY IF EXISTS <name> ON <table>;` before every `CREATE POLICY`, so the file re-applies cleanly.
5. If the table needs to be readable/writable from the public API's service-role client (`src/lib/auth/api-context.ts`), that client bypasses RLS entirely — the policy still matters for the dashboard's cookie-session path, but don't assume it's the only enforcement. The app-layer `.eq('account_id', ctx.accountId)` filter is what protects the service-role path.

## Money / secrets / other constrained columns

- Store secrets as a hash (`text` SHA-256 hex, see `api_keys.key_hash`) or encrypted ciphertext (see `whatsapp_config` token columns), never plaintext. A short non-secret `_prefix` display column is fine for UI (`key_prefix`).
- `ON DELETE SET NULL` for an audit/attribution FK (`created_by`) so removing a teammate doesn't cascade-delete data others depend on; `ON DELETE CASCADE` for genuine ownership (`account_id`).

## After writing the migration

Update `docs/public-api.md` if the change touches anything the public API surfaces (new scope, new endpoint, new response field) — that doc is user-facing and doesn't auto-derive from the schema.
