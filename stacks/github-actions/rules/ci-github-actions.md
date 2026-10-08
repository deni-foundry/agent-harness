---
targets: ["*"]
description: "GitHub Actions CI for a Supabase + Vite/Playwright app: job shape, local Supabase in CI, deploy pitfalls (Supabase CLI, Cloudflare Workers/Pages), env vars and secrets"
globs: ["**/.github/**"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/.github/**"]
---

> Source: agent-harness `stacks/github-actions/rules/ci-github-actions.md`. Edit it there; this copy is generated.

# CI/CD with GitHub Actions

## CI Workflow

**Trigger CI on pushes and PRs to the pre-production branches only** (for example a development
branch and a staging branch). If the production branch is deliberately not a CI trigger —
production deploys run without a CI gate, on the reasoning that it only ever receives code that
already passed CI on staging — then merging anything else directly into it bypasses every CI job.

### Key Design Decisions

**Tests always use local Supabase** — never staging/production, because tests create and delete
data, run in parallel, and need a predictable clean state.

**Credentials are read at runtime, not hardcoded.** Each Supabase-using job starts the stack and
then resolves keys from `supabase status --output json` into step outputs:

```yaml
- name: Get Supabase credentials
  id: supabase
  run: |
    echo "api_url=$(supabase status --output json | jq -r '.API_URL')" >> $GITHUB_OUTPUT
    echo "anon_key=$(supabase status --output json | jq -r '.ANON_KEY')" >> $GITHUB_OUTPUT
    echo "service_key=$(supabase status --output json | jq -r '.SERVICE_ROLE_KEY')" >> $GITHUB_OUTPUT
```

Downstream steps reference `${{ steps.supabase.outputs.api_url }}` etc. Don't paste literal keys
into the workflow.

### Jobs

A shape that works: `checks`, `lint`, `unit-tests` and `worker-e2e` run on every trigger; the two
Supabase jobs run for the staging branch only:

| Job                     | Runs on                        | What                                                              |
|-------------------------|--------------------------------|-------------------------------------------------------------------|
| `checks`                | every push/PR                  | All `tsc` configs and generated-artifact drift guards             |
| `lint`                  | every push/PR                  | `eslint` with a content-keyed cache                               |
| `unit-tests` (2 shards) | every push/PR                  | `vitest --run --shard=N/2 --maxWorkers=2`                         |
| `worker-e2e`            | every push/PR                  | Production build + Playwright against `wrangler dev`              |
| `integration-tests`     | staging pushes + PRs → staging | `npm run test:integration` against a real local Supabase          |
| `e2e-tests` (2 shards)  | staging pushes + PRs → staging | Playwright (Chromium) against the production build, `--shard=N/2` |

**Why this shape.** In a private repository `ubuntu-latest` is a 2-vCPU runner.
Vitest defaults to CPUs − 1 workers, which is one worker there — hence `--maxWorkers=2`.
Work that used to run back to back in one `unit-tests` job (type checks, lint, tests) is split
into parallel jobs, and the two slow suites are sharded. Each E2E shard starts its own Supabase
and runs one worker, so no two tests share a database at the same time. A suite that only needs
to run once runs on E2E shard 1 only. A check script that only runs one Vitest file the unit
shards already run should not be a separate CI step.

**Supabase starts in the background.** A small wrapper script with a `background <excludes>` mode
returns immediately so `npm ci` and the Playwright download overlap the ~100 s image pull and
boot; its `wait` mode blocks until it finished and prints its log. Retries for flaky port
binds (Mailpit is the usual one) belong in that script. There is no `supabase stop` step: the
runner is discarded, and stopping cost ~20 s per job.

**Playwright installs the headless shell only** (`--only-shell`). Every CI config runs headless,
which uses `chromium-headless-shell`, so the full Chromium download was unused.

**No `--with-deps`; pin the runner image.** The GitHub-hosted Ubuntu image already has every
library Chromium needs; `--with-deps` only apt-installs fonts that tests do not use, and a slow
Ubuntu mirror once stretched that step to almost 8 minutes while the browser download took ~3 s.
Pin Playwright jobs to `runs-on: ubuntu-24.04` rather than `ubuntu-latest`, so a runner-image
upgrade cannot drop a library unnoticed. If one does go missing, the browser fails to launch and
the job fails loudly; add `--with-deps` back for that job then.

**`concurrency`.** The CI workflow cancels an in-progress run when a newer push lands on the same
branch or PR. Deploy workflows serialize instead (`cancel-in-progress: false`): a second push
queues behind a running deploy rather than racing its `supabase db push` and Edge Function upload.

Both gated jobs share a branch condition, here for a branch named `staging`:
```yaml
if: github.ref == 'refs/heads/staging' || (github.event_name == 'pull_request' && github.base_ref == 'staging')
```
So a green PR into the development branch has run type checks, unit tests, and Worker Playwright.

**Skipping CI.** Put `[skip ci]` in the commit message (`[ci skip]`, `[no ci]`,
`[skip actions]` and `[actions skip]` work too). GitHub skips `push` / `pull_request` workflows when the
**tip commit** of that push (or the PR HEAD) contains the token — every matching
workflow, including deploys and changelog, not just tests.

The token lives on the commit, so it follows the SHA. A fast-forward of the development
branch into staging leaves that same commit as staging's tip and will
skip CI **and** the staging deploy. Safe only when staging gets a new
commit whose message does not contain the token (GitHub's default merge-commit
message does; a squash that copies the original message does not). Do not leave
`[skip ci]` on a commit that will be the tip of a deploy branch.

**`unit-tests` does not start Supabase at all.** It runs against a placeholder URL and key
(e.g. `http://127.0.0.1:54321`), which is why it is fast. Anything needing a real database
belongs in `integration-tests`.

**Lint gates unless the project carries a backlog.** A project with a known lint backlog can run
the `lint` job with `continue-on-error: true` against a backlog report (its own CI rule says
whether it does); flip it to gating once the backlog is triaged.

**Edge Functions are never typechecked** unless a workflow runs `deno`. `supabase/functions/`
is usually outside `tsconfig.json`, and `supabase functions deploy` does not
typecheck — so a `tsc --noEmit` covers `src/` only. Anything under `supabase/functions/`
then ships unverified; verify it locally with
`npx -y deno@2 check supabase/functions/<fn>/index.ts`, which picks up an existing
`deno.json`.

**Do not add `supabase db reset`.** `supabase start` already applies migrations and seeds.
Resetting restarts containers and races the Mailpit port bind, which is a documented flake.

**The Playwright report uploads on every non-cancelled run** (`if: ${{ !cancelled() }}`), not only
on failure, so a passing run still has an artifact.

### Excluded Supabase Services

Both Supabase-using jobs pass `-x` excludes to speed startup. `studio` and `postgres-meta` are
the dashboard, which CI never opens, and `studio` is the largest image to pull:

| Job                 | Excluded                                                                             | Kept                               |
|---------------------|--------------------------------------------------------------------------------------|------------------------------------|
| `integration-tests` | realtime, imgproxy, logflare, vector, supavisor, studio, postgres-meta               | storage-api, edge-runtime, mailpit |
| `e2e-tests`         | realtime, imgproxy, edge-runtime, logflare, vector, supavisor, studio, postgres-meta | storage-api, mailpit               |

## Deploy pitfalls

**Gate a deploy on CI by calling it, not by `workflow_run`.** Make the deploy a reusable
workflow (`on: workflow_call`) and call it from the CI workflow's last job with `needs:` on every
gating job and `secrets: inherit`, so a red CI never deploys. `workflow_run` looks simpler but
runs on the default branch, so an environment whose branch policy allows only the deploy branch
rejects it. Three consequences of calling instead: give the deploy workflow a literal
`concurrency` group (inside a called workflow `github.workflow` is the caller's name, and sharing
the caller's group deadlocks); stop CI from cancelling in-progress runs on the deploy branch, or a
newer push cuts a deploy off mid-migration; and look up the deploy's runs and artifacts under the
CI workflow, which now owns them.

**Publish last.** Build the frontend bundle in parallel with the database deploy (pushing
migrations and functions), and make the publish job `needs:` both, so the UI never reaches
users before the schema it depends on while wall time stays at the slower of the two.

**Pin the Supabase CLI to one version everywhere** — the `supabase` package in `package.json`,
every CI job and every deploy workflow — and bump them together. A deploy on `latest` changes
the deploy tool with every CLI release, unannounced.

**GitHub runners are IPv4-only.** Connect a workflow to hosted Supabase Postgres through the
session pooler URI, not `db.<ref>.supabase.co`.

**Keep the default branch out of environment branch policies.** Scheduled workflows always
start on the default branch; if it may use the staging or production environment, any
workflow on it can read those secrets. Re-dispatch onto the environment's own branch instead.

**`upload-artifact` skips hidden paths.** `actions/upload-artifact` skips hidden (dot-prefixed)
paths by default, so never stage an artifact in a dot-prefixed directory.

**Strip Pages files before a Workers deploy.** Before uploading a build to Cloudflare Workers
Static Assets, remove `dist/_redirects` and `dist/_headers` so Workers Static Assets does not
parse leftover Pages SPA fallback files (absolute `pages.dev` URLs are also invalid there).

**One hostname, one owner.** A hostname cannot be a Cloudflare Pages custom domain and a Worker
custom domain at once. Remove it from the Pages project before the first Worker deploy, or
Wrangler will fail to attach the hostname. The API token must allow Workers Scripts (and custom
domains / routes), not only Pages:Edit.

**Edge Function deploy skip.** `supabase functions deploy` prints `No change found in
Function: <slug>` and skips the upload when the bundle hash matches what it already
has remote. That is not "this git tree is live on this project" — an environment can stay
on an older function while the job stays green. Pass `--use-api` (bundle from uploaded source,
no Docker layer cache) and check the deploy log: fail the job if a skipped function changed
under `supabase/functions/` in the push (`_shared` counts as every function). To recover a
stale function by hand: `supabase functions deploy <slug> --use-api --project-ref <ref>`.

**One writer per environment — keep the Supabase GitHub integration off.** When workflows
deploy migrations and Edge Functions, they must be the only writer. The Supabase GitHub
integration will do both itself if enabled, and it is two independent switches in Project
Settings > Integrations > GitHub:

| Switch                                       | Governs                                     | Must be |
|----------------------------------------------|---------------------------------------------|---------|
| Automatic branching / per-commit branch runs | persistent Supabase branches (e.g. staging) | off     |
| Deploy to production                         | the production branch                       | off     |

Turning one off does not affect the other. When both writers run, they race, and the
loser's bundle can be what stays live while **both** report success — so the pipeline
is green and the environment is on old code. A deploy-log skip check does
not catch it: it only detects the CLI *skipping* a changed function, and in
a race the CLI neither skips nor fails. Diagnose by querying the project's own
`workflow_run_logs` — a `Deploying Function: <slug>` line there is the integration,
not your workflow.

Disabling both costs nothing when `supabase db push` covers migrations, the functions step
covers functions, and `config.toml` declares no storage buckets. Check branch
protection first if anything requires the integration's `supabase/**` status check.

**`wrangler-action` brings its own wrangler.** Run `npm ci` before `cloudflare/wrangler-action`:
without a local install, `wrangler-action` installs its own default wrangler, so the deploy
silently runs a different wrangler than the one pinned in `package.json`.

## Adding New Environment Variables

### For CI Tests
Add directly to the CI workflow under the `env:` section of the test step.

### For Staging/Production Builds
1. Add to GitHub Secrets (Settings → Secrets → Actions)
2. Reference in deploy workflow: `${{ secrets.YOUR_SECRET }}`

### For Edge Functions
Set via Supabase Dashboard or CLI:
```bash
supabase secrets set KEY=value
```

### For Postgres (triggers and pg_cron)
These do **not** come from `supabase secrets` — Postgres cannot read the Edge Function
runtime's environment. Triggers and cron jobs that call Edge Functions read the project URL
and service role key from Vault, which is a manual step per environment that no migration or
workflow performs. See "Calling Edge Functions from Postgres" in the `supabase` rule.

Skipping it does not fail a deploy: every caller treats a missing key as "skip", so every
feature behind those triggers goes silently dead while the
pipeline stays green. Verify after any new environment, project restore or branch with the
`net._http_response` query in that section.

## Troubleshooting

### CI Tests Failing with Supabase Errors
- Check if migrations are up to date
- Verify the local Supabase ports match `supabase/config.toml`
- Check if excluded services are actually not needed

### Deploy Failing
- Verify GitHub Secrets are set for the correct **environment** (not repo-level)
- GitHub environment secrets are isolated — same values must be duplicated across environments
- Check Supabase access token hasn't expired
- Verify Cloudflare API token has correct permissions (Workers Scripts: Edit)
- Edge Functions: a green `functions deploy` can still skip a changed slug (`No change found`).
  A deploy-log check should catch that; if a function is stale anyway, deploy it by name with
  `--use-api --project-ref` and confirm `Deploying Function:` not `No change found`.

## CLI Output in CI

When capturing CLI tool output in CI pipelines, always strip ANSI escape codes before processing. Use `sed 's/\x1b\[[0-9;]*m//g'` or equivalent.

## GitHub Environment Secrets

All secrets for staging/production workflows are stored as GitHub Environment secrets (Settings → Environments → staging). Any workflow job that needs these secrets must include `environment: staging` (or `production`) in the job definition.
