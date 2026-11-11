# Cloudflare facts the deploy depends on: R2 credentials, token verify, lifecycle rules, Wrangler secrets

**Date**: 2026-11-11
**Type**: constraint
**Theme**: deploy
**Summary**: R2 S3 keys derive from an API token; user tokens verify for any account; the lifecycle resource replaces every rule.
**Context**: .minerva/work/2026-11-11-terraform-doppler-deploy (see git history if the worktree has been cleaned up)

## Context
The deploy script derives Terraform's state-backend credentials from the one Cloudflare API token in Doppler, and the bootstrap checks that token and the account before storing them. Several Cloudflare and tool behaviours shaped that code.

## Finding
- **R2's S3 credentials for an API token:** access key id = the token's id, secret access key = SHA-256 hex of the token value. The id comes from `/user/tokens/verify` for a user-owned token or `/accounts/{id}/tokens/verify` for an account-owned one.
- **A user-owned token verifies whatever account id is given**, so a wrong account id first fails later with a misleading error (e.g. "R2 is not enabled"). The bootstrap checks `GET /accounts/{id}` on its own first.
- **`cloudflare_r2_bucket_lifecycle` (provider 5.28.1) sets the bucket's whole rule list.** It drops R2's default rule for new buckets (abort unfinished multipart uploads after 7 days) unless that rule is declared too. `max_age` is in seconds; an empty `prefix` covers the whole bucket.
- **Wrangler 4.160 `--secrets-file`** takes JSON or dotenv, uploads the values with the deploy, prints them as `(hidden)`, and is additive. `--var KEY:VALUE` splits on the first colon. `wrangler kv namespace list` prints plain JSON.
- **`hashicorp/setup-terraform`'s default wrapper** echoes commands into stdout and copies output into step outputs, which corrupts `terraform show -json` / `output -json` parsing; it is off (`terraform_wrapper: false`).
- **GitHub creates a missing environment, unprotected, the first time a job names it.** The bootstrap applies `.github/environments/production.json` every run and reads it back before storing `DOPPLER_TOKEN`.
- **Unverified:** whether R2 honours the s3 backend's `use_lockfile` conditional write. The `deploy` concurrency group is what serializes writers.

## Implications
- Rotating the Cloudflare token also rotates the state credentials; nothing else changes.
- A new lifecycle rule goes into the same `rules` list, never a second lifecycle resource.

## Related
- [[2026-11-11-decision-terraform-bindings-wrangler-worker-doppler-secrets]] — the design these facts constrain
