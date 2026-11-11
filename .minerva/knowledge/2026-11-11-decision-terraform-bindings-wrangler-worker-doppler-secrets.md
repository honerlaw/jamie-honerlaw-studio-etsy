# Terraform owns the Worker's bindings, Wrangler the Worker, Doppler every secret

**Date**: 2026-11-11
**Type**: decision
**Theme**: deploy
**Summary**: Terraform makes the R2 bucket and KV namespaces, Wrangler deploys the Worker, Doppler holds every secret, CI is the only writer.
**Context**: .minerva/work/2026-11-11-terraform-doppler-deploy (see git history if the worktree has been cleaned up)

## Context
v1 was merged but never deployed. The R2 bucket was to be made by hand-typed `wrangler` commands, KV namespaces by an unrecorded first deploy, and the eight Worker secrets lived in a local `.dev.vars` and whatever was last `wrangler secret put`. The owner asked for Terraform for infrastructure, Doppler for secrets, and auto-deploy on merge to `main`.

## Finding
- **Terraform (`infra/`)** owns only the account resources the Worker binds to: the `etsy-shop-uploads` bucket and its lifecycle rules, and the `etsy-shop-mcp-oauth` / `etsy-shop-mcp-shop` KV namespaces. The data-holding three carry `prevent_destroy`. State is in the `etsy-shop-mcp-tfstate` R2 bucket (s3 backend), made once by `npm run bootstrap`.
- **Wrangler** keeps the Worker script, Durable Objects and migrations, cron and vars. The deploy writes a gitignored `wrangler.deploy.json` with Terraform's KV ids, so `wrangler.jsonc` carries no ids.
- **Doppler** `etsy-shop-mcp/prd` holds the eight `secrets.required` values plus `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. GitHub holds one secret, a read-only Doppler service token, in a `production` environment limited to `main`.
- **CI is the only Terraform writer.** `scripts/deploy.ts` refuses to run outside `deploy.yml` on main (an accident guard, not enforcement); there is no local deploy path. State refactors and recovery go only through committed `import`/`moved`/`removed` blocks.
- Rejected: Terraform deploying the Worker (bundling and DO migrations in HCL, secrets in state); Terraform for R2 only (two tools creating resources); Terraform managing Doppler and GitHub (CI's credential managed by the state it unlocks); committed KV ids; `doppler run` wrapping the deploy; a local break-glass deploy (a second unserialized writer whose `::add-mask::` lines print secrets to a terminal).

## Implications
- A secret change is `doppler secrets set` followed by `gh workflow run deploy.yml`; Doppler changes deploy nothing by themselves.
- `wrangler deploy --secrets-file` is additive, so a secret dropped from `secrets.required` stays on the Worker until `wrangler secret delete`.
- Whoever can merge to `main` can change `deploy.yml` and its pinning test together; the pins make that visible, not impossible.

## Related
- [[2026-11-10-pattern-gates-pin-themselves]] — the deploy workflow's shape is pinned the same way as the merge gates
- [[2026-11-11-constraint-chat-apps-cant-hand-photos-to-mcp-tools]] — the R2 uploads bucket Terraform now owns
