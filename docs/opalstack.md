# Deploying to Opalstack

This fork runs on [Opalstack](https://opalstack.com) as a Node.js app
resource, not Docker or Hostinger's managed Node.js. Opalstack scaffolds
each Node.js app with a fixed directory layout and a pair of
`start`/`stop` scripts that daemonize the process — this doc covers how
that's wired to auto-deploy from GitHub.

## Layout on the server

```
~/apps/tramparnagringa-crm-whatsapp/
  activate       # sources this app's own Node version onto PATH — must be `source`d, not executed
  start          # daemonizes `npm start -- -p 1197`, tracked by a PID file
  stop           # kills that daemon via the PID file
  resurrect      # cron-driven healthcheck watchdog (independent of deploy — see below)
  wacrm/         # the actual `git clone` of this repo; PROJECTDIR in start/stop
```

The app listens on `127.0.0.1:1197`; Opalstack's front-end proxies the
public domain to it.

## The deploy pipeline

`.github/workflows/deploy-opalstack.yml` runs after `CI` succeeds on
`main` (via `workflow_run` — this deploys the same commit CI just
verified, not a race against it). It:

1. Checks out that exact commit, installs the Supabase CLI (pinned to
   the same version as `migrations.yml`), links to the production
   project, and runs `supabase db push` — applies any
   `supabase/migrations/*.sql` that isn't in production's
   `schema_migrations` yet, **before** the app restarts. If this step
   fails, the job stops here — the SSH deploy steps below never run,
   so code that depends on a schema change never ships against a
   database that doesn't have it.
2. SSHes in with a dedicated deploy key (see below) and, in
   `wacrm/`: `git fetch origin main && git reset --hard origin/main`
   — hard reset, not a plain pull, so the server always matches GitHub
   exactly regardless of any stray local edit.
3. `source ../activate` to get this app's Node onto `PATH`.
4. `npm ci && npm run build`.
5. `../stop || true && ../start` — restart the daemon. `stop` exits
   non-zero if the app was already stopped, hence `|| true`.
6. A health check (`curl` against `127.0.0.1:1197/`) — the job fails
   loudly if the restarted process isn't answering, rather than
   reporting a green deploy that's actually down.

### Migration credentials

`supabase db push` needs its own two secrets, separate from the
Opalstack deploy key: `SUPABASE_ACCESS_TOKEN` (a personal access token
— [dashboard/account/tokens](https://supabase.com/dashboard/account/tokens))
and `SUPABASE_DB_PASSWORD` (the production project's database
password — Project Settings → Database). The project ref itself
(`iqitekmnkgokzgztxnzt`) isn't sensitive and is inlined in the
workflow.

### `workflow_dispatch`

Also wired as a trigger, for two reasons: to manually re-deploy without
pushing an empty commit, and because `workflow_run` only fires for
whatever version of this workflow file is on the **default branch** —
`workflow_dispatch` is the only way to test a change to the pipeline
itself before merging it.

### Deploy key

Access uses a dedicated ed25519 keypair, not anyone's personal key —
its public half is one more line in the server's
`~/.ssh/authorized_keys` (`github-actions-deploy@wacrm`), and the
private half lives only in the `OPALSTACK_SSH_KEY` repo secret. If it
ever needs rotating: generate a fresh keypair, append the new public
key to `authorized_keys` on the server, `gh secret set
OPALSTACK_SSH_KEY < path/to/new/key`, then remove the old public key
line from `authorized_keys`.

## `resurrect` — this is not the deploy pipeline

`~/apps/tramparnagringa-crm-whatsapp/resurrect` is a separate,
pre-existing cron-driven healthcheck: it polls `127.0.0.1:1197/`, and
on a confirmed failure kills and restarts via the same `start` script,
emailing `contato@tramparnagringa.com.br` either way. It runs
independently of every deploy and exists to recover from a crash
between deploys, not to apply new code — a deploy always calls
`stop`/`start` itself rather than relying on `resurrect` to notice.

## Manual redeploy / rollback

Trigger the workflow manually from the Actions tab (or `gh workflow run
"Deploy to Opalstack"`) to redeploy the current `main` on demand. To
roll back, `git reset --hard <sha>` on `main` and push (force-push, or
revert commits) — the next deploy run applies whatever `main` points
to; the pipeline has no independent version history of its own.
