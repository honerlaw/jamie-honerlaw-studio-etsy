# Production deploy — how it works

Present-tense description of how `etsy-shop-mcp` reaches Cloudflare. The one-time setup and the runbook are in the README ("Setting up the server", "Runbook"); the design and its rejected alternatives are in `.minerva/work/2026-11-11-terraform-doppler-deploy/proposal.md`.

## Who owns what

| Piece | Owner | Where it is declared |
| --- | --- | --- |
| R2 bucket `etsy-shop-uploads`, its 1-day `uploads/` rule and R2's default 7-day multipart-abort rule | Terraform | `infra/main.tf` |
| KV namespaces `etsy-shop-mcp-oauth` (`OAUTH_KV`) and `etsy-shop-mcp-shop` (`SHOP_KV`) | Terraform | `infra/main.tf`; ids come out as `kv_namespace_ids` |
| Worker script, Durable Objects and migrations, cron, plain vars | Wrangler | `wrangler.jsonc` |
| Terraform state bucket `etsy-shop-mcp-tfstate` | `npm run bootstrap` (once) | `scripts/bootstrap/cloudflare-setup.ts` |
| Every secret: the 8 in `secrets.required`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Doppler, project `etsy-shop-mcp`, config `prd` | `npm run bootstrap` creates the project and fills what it can |
| `DOPPLER_TOKEN` (read-only service token for `prd`) | GitHub environment `production` | `.github/environments/production.json` limits it to `main` |

The bucket and both namespaces carry `prevent_destroy`; the lifecycle rules do not. `wrangler.jsonc` has no KV ids.

## What a deploy does

`.github/workflows/deploy.yml` runs after CI succeeds on a push to `main`, or on `gh workflow run deploy.yml` from `main` (inputs `bootstrap`, `allow_destroy`). Its `gate` job deploys only the commit that is still the tip of `main` (so a re-run never rolls back), and on a dispatch requires the latest `ci-pass` check run from GitHub Actions (app 15368) on that commit to have succeeded. The `gate` job has no concurrency group, so a run it turns away never joins the `deploy` group. (A manual "Re-run failed jobs" of an older run skips the gate and joins the group, where it can displace a pending deploy of the tip before its own tip check stops it; it then warns, and the README runbook says to dispatch instead.) The `deploy` job runs in the `production` environment and the `deploy` concurrency group (one at a time; a newer tip's deploy may replace a still-pending one). Its first step checks the tip of `main` again, because "Re-run failed jobs" reuses the `gate` job's old outputs and must never roll production back, and skips with a warning when `DOPPLER_TOKEN` is absent. Then it checks out the gated commit, runs `npm ci` (install scripts run only for the pinned esbuild and workerd in `allowScripts`), installs Terraform 1.14.7 without the wrapper and runs `node scripts/deploy.ts` with only `DOPPLER_TOKEN` (plus the two flags) in that step's environment.

`scripts/deploy.ts` (logic in `scripts/deploy/run-deploy.ts`):

1. Refuses unless `GITHUB_ACTIONS` is `true` and `GITHUB_WORKFLOW_REF` names `deploy.yml` on `refs/heads/main`. This is an accident guard, not enforcement: what keeps CI the only writer is that no one holds a `DOPPLER_TOKEN` outside the `production` environment.
2. Downloads the `prd` secrets from `https://api.doppler.com/v3/configs/config/secrets/download?format=json` with the token as a bearer token, dropping Doppler's `DOPPLER_*` metadata.
3. Prints `::add-mask::` for every `secrets.required` value and `CLOUDFLARE_API_TOKEN` (each line and each JSON string leaf; values under 8 characters and `unset` are skipped), before printing anything else.
4. Fails, naming the keys but no values, if any required or pipeline secret is missing. Nothing has run yet.
5. Resolves the API token's id (`/user/tokens/verify`, then `/accounts/{id}/tokens/verify` for an account-owned token) and derives R2's S3 credentials: access key id = token id, secret = SHA-256 hex of the token. The derived secret is masked too.
6. Runs `terraform init -lockfile=readonly`, `plan -out=tfplan`, reads `show -json tfplan` and **refuses to apply** if any change includes `delete` (deletes and replacements) unless `--allow-destroy`; then `apply tfplan` and `output -json`. Terraform's env is an allowlist: `PATH`, `HOME`, `CI`, `TF_IN_AUTOMATION`, `TF_INPUT=0`, `CLOUDFLARE_API_TOKEN`, `TF_VAR_account_id`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`.
7. Writes `wrangler.deploy.json` at the repo root (gitignored): `wrangler.jsonc` with each KV binding's id from `kv_namespace_ids`, failing if one is missing.
8. Writes exactly the `secrets.required` values to a 0600 JSON file under `RUNNER_TEMP`, runs `wrangler deploy --config wrangler.deploy.json --secrets-file <file>` (plus `--var ALLOWLIST_BOOTSTRAP:true` with `--bootstrap`) with an env of `PATH`, `HOME`, `CI`, `WRANGLER_SEND_METRICS=false`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and deletes the file whether or not the deploy succeeded.

Secrets never pass through `$GITHUB_ENV`, step outputs, command-line arguments or Terraform state.

## Facts this depends on

- **Wrangler `--secrets-file`** (pinned wrangler 4.160.0) uploads the file's secrets with the deploy. It is additive: a secret dropped from the file stays on the Worker until `wrangler secret delete`.
- **R2 S3 credentials from an API token:** the access key id is the token's id and the secret access key is the SHA-256 hex of the token value. The token needs Workers R2 Storage Edit.
- **Terraform state** uses the `s3` backend against R2 (`region = "auto"`, path-style, the `skip_*` checks off, `use_lockfile = true`). Whether R2 honours the lockfile's conditional write is unverified; the `concurrency: deploy` group is what serializes writers.
- **Recovering or refactoring state** goes only through committed `import {}`, `moved {}` and `removed {}` blocks applied by the workflow. KV titles are unique per account, so missing state fails on create instead of making empty namespaces.
- **GitHub creates a missing environment, unprotected,** the first time a job names it. So `npm run bootstrap` (and `npm run apply-environment`) always applies `.github/environments/production.json` and reads it back before storing `DOPPLER_TOKEN`.
- **A Doppler change deploys nothing.** Run `gh workflow run deploy.yml` after changing a secret.

## Lint for the scripts

The deploy and bootstrap scripts are TypeScript (`scripts/**/*.ts`, run by Node 24's type stripping, typechecked by `tsconfig.scripts.json`). They get the full type-aware rule set that `src/` gets, minus `agentic/one-export-per-file`, and write output through `scripts/lib/output.ts` (`process.stdout`/`process.stderr`), so they need no `no-console` exception. The older `.mjs` repo scripts keep their `no-console` and `disableTypeChecked` carve-outs in `eslint.config.ts`; those match `.mjs` files only (`scripts/**/*.mjs` and `**/*.mjs`) and deliberately do not extend to `.ts`. `tests/gate-integrity.test.ts` checks the rule set on `scripts/deploy.ts` and `scripts/deploy/run-deploy.ts`.

## What the checks cannot stop

`main` merges on a green `ci-pass` with no required approval. Whoever can merge to `main` can change `.github/workflows/deploy.yml` and its pinning test `tests/deploy-workflow.test.ts` (or `scripts/deploy.ts` and its tests) in the same PR, and the next deploy runs that code with `DOPPLER_TOKEN`, which reads every production secret. The pins make such a change visible in the diff; they do not prevent it. The same goes for dependencies: `scripts/deploy.ts` loads `typescript` from `node_modules` while it holds every fetched secret, and the allowed install scripts (pinned esbuild and workerd) run earlier on the same runner, so a compromised one of those is inside the boundary. The environment's main-only policy limits who can deploy to people who can merge, and no further.

## Checks that pin this

- `npm run check:infra` (CI job `terraform`, needed by `ci-pass`): `terraform fmt -check`, `init -backend=false -lockfile=readonly`, `validate`. Its text is pinned by `tests/gate-integrity.test.ts`.
- `tests/deploy-workflow.test.ts` pins `deploy.yml`'s triggers, environment, permissions, gate, secret references and action pins.
- `tests/scripts/` tests the deploy and bootstrap scripts with an injected command runner and fetch.
