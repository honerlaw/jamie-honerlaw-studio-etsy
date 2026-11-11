# Scratchpad: terraform-doppler-deploy

> **Ephemeral working memory.** Most of what lands here is noise — small
> decisions that don't matter, dead ends, momentary confusion. At feature
> completion, run `minerva:promote`: significant items get promoted to
> `.minerva/knowledge/`, `proposal.md` gets updated to match reality, and
> the raw scratchpad is archived.

## Decisions 2026-11-11
- [solo] open-issue match: no match — only open issue is #4 (GPSR listing fields), unrelated (tier: hardcoded check, no ask)
- [reviewed — folded] scope check: one unit, one PR; Skeptic accepted the scope but named missed surfaces (AGENTS.md gate chain, dependabot terraform entry, README ci-pass list, environment auto-creation, DOPPLER_TOKEN pin contradiction, dispatch CI check) — folded (tier: reviewer — multi-surface, not provably small; interface-clause doubt on README/deploy.yml passed to the Skeptic, answered "no": nothing deployed, only consumer is the owner; parallel wave)
- [rechecked — escalated] scope check: fold-audit found load-bearing new concerns introduced by the revision (local break-glass deploy = second unserialized Terraform writer; `::add-mask::` printing secrets on a terminal) → panel
- [panel — 3/3 accept, 3 with fixes] scope check: one unit, one PR, no phases (tier: panel — fold-audit escalation)
    - fix (proponent/arbiter): surface list updated to v3+ (tsconfig.scripts.json, .ts scripts, package.json scripts, vitest coverage include, knip, eslint project lists, spawn tests)
    - fix (skeptic/arbiter): script tests under tests/scripts/** typechecked by tsconfig.scripts.json, excluded from tsconfig.node.json; eslint project lists gain tsconfig.scripts.json
    - fix (skeptic/arbiter): boundary note — unit done at merge; first live deploy outside its criteria, failures via minerva:debug + fix PR
    - fix (arbiter): extra pins (typecheck text, coverage include, scripts lint sample); apply-environment two-resource wording; .mjs/.ts carve-out split stated; runbook "don't merge between bootstrap dispatch and setting ids"
- [reviewed — folded] approach: option A kept; Skeptic found a missing destroy guard on auto-apply, unprotected auto-created environment, wrong mask set, user-only token-id lookup, env-override pin, raw `npm run deploy` — folded (tier: reviewer — approach-bearing, multi-surface; rejected B Terraform-deploys-Worker, C Terraform-R2-only, Terraform-managed Doppler/GitHub, committed KV ids, `doppler run`; interface doubt answered "no"; parallel wave)
- [rechecked — escalated] approach: fold-audit found a high new concern (break-glass local path prints every secret via `::add-mask::`) and a second unserialized Terraform writer → panel
- [panel — 3/3 accept, 3 with fixes] approach: option A (tier: panel — fold-audit escalation)
    - fix: state recovery/refactors only via committed import/moved/removed blocks applied by CI; KV titles named
    - fix: GITHUB_ACTIONS (+ GITHUB_WORKFLOW_REF) refusal described as an accident guard; spawn test clears GITHUB_ACTIONS
    - fix: prevent_destroy on bucket + both namespaces (not the lifecycle rule); child envs as tested allowlists; workflow runs `node scripts/deploy.ts` directly; env reconcile deletes extra policies; runbook entries (token rotation, delete-guard refusal, post-merge Terraform errors); confirm --secrets-file on pinned wrangler 4.160.0; pins for ci.yml-no-production-env and env JSON exactly main
- [reviewed — folded] whole-proposal: Skeptic found an unstated GitHub-environment trap, ambiguous criterion 2 (github.token), .mjs scripts outside typecheck, missing R2/workers.dev prerequisites, thin criteria 3/4 — folded (tier: reviewer; parallel wave)
- [reviewed — folded] whole-proposal (restart): first-wave review stale because the approach fold rewrote `## Success criteria`; re-review found the tsconfig.node.json pin collision, setup-terraform wrapper, checks: read, bootstrap order, Doppler CLI unpinned (→ direct API fetch), MCP credential gap — folded (tier: reviewer; parallel wave restart)
- [rechecked — escalated] whole-proposal: fold-audit reproduced TS5097 when tests in tests/ import .ts scripts under tsconfig.node.json (high) → panel
- [panel — 3/3 accept, 3 with fixes] whole-proposal: sound (tier: panel — fold-audit escalation)
    - fix (both, probed): entry files branchless (`await runCli(import.meta, main)`); guarded form measured 66.66% lines / 50% branches
    - fix: coverage collection confirmed by probe (node project covers scripts once in include)
    - fix: environment reconcile in a TS module through the injected gh runner (no apply-environment.sh); knip entry scripts/*.ts, project scripts/**/*.ts; wrangler.jsonc KV/R2 comments; lint pin rule list; CI job runs `npm run check:infra`; use_lockfile fallback; Goal reworded to something checkable; check:infra text-pin justification
- [reviewed — revise] completion verification: Verifier reproduced criteria 1, 2, 5, 6, 7 (full gate chain exit 0); 3 and 4 unmet — the byte-for-byte JSON-secret claim is unpinned (fixtures already compact) and "state bucket created only when missing" has no 200→no-POST assertion → success-criteria divergence, Phase 2.5 (tier: reviewer floor — Verifier, asymmetric; no panel predicate: no interface beyond the approved one)
- [panel — 3/3 accept, 3 with fixes] new-plan acceptance: keep criteria, pin the two claims, add the two deploy.md sections (tier: panel floor)
    - fix (both/arbiter): step 1 asserts the parsed secrets-file value equals a single-line whitespace JSON fixture via the existing toStrictEqual; "key order" dropped (V8 keeps non-integer key order); masks stay valid
    - fix (both/arbiter): step 2 asserts on fetch requests (exact four GETs, no POST to /r2/buckets) and no "Created…" line, not on runner calls
    - fix (skeptic/arbiter): each new assertion shown to fail against a deliberately broken implementation, then reverted
    - fix (skeptic/arbiter): residual-trust section names deploy.yml + tests/deploy-workflow.test.ts changeable in one PR; lint-split section resolves the eslint.config.ts pointer; "closes with Phase 3" reworded
- [solo] triage: 3 code-review findings — #1 FIX (workflow-level concurrency lets a non-deploying run cancel a pending tip deploy; split into a gate job without concurrency and a deploy job with job-level `concurrency: deploy`, keeping one Terraform writer), #2 FIX (bootstrap stores the Cloudflare token/account id before verifying them; verify first, store after, and name `doppler secrets set` when a stored value fails), #3 FIX comment only (npm 11 `allowScripts` already limits install scripts to pinned esbuild/workerd, so "never during dependency installs" is reworded to state the real boundary) (tier: solo — each has one dominant disposition by the deferral bar; no replan-vs-FIX: criteria and approach unchanged, concurrency still serializes every deploy)
- [reviewed — clean] completion verification (after replan): Verifier reproduced all 7 criteria, including both new assertions failing against deliberately broken implementations; full gate chain exit 0 (tier: reviewer floor — Verifier)
- [solo] triage (final-diff review): 4 findings — #1 FIX high (job split let "Re-run failed jobs" reuse stale gate outputs and deploy a non-tip commit; re-check the tip as the deploy job's first step, after the concurrency group is acquired), #2 FIX low (wrong account id reported as "R2 not enabled"; GET /accounts/{id} first), #3 FIX low (lifecycle resource replaces R2's default 7-day multipart-abort rule; declare it), #4 FIX doc (the deploy process itself loads `typescript` from node_modules — state the trust boundary) (tier: solo — one dominant disposition each; no replan-vs-FIX: #1 restores the approved tip-of-main promise, approach unchanged)
- [solo] triage (fix-delta review): 3 findings — #1 FIX medium (a manual "Re-run failed jobs" of a non-tip run joins the deploy group and can displace the tip's pending deploy; unavoidable while gate outputs are reused, so the stale skip becomes a ::warning:: naming `gh workflow run deploy.yml`, a runbook line, and the "can never cancel" claims reworded), #2 FIX low (tip-check pins accept a fail-open edit; pin the exact skip blocks), #3 FIX low (a dispatch skipped as stale warns instead of notices) (tier: solo — one dominant disposition each)
- [solo] promote partition: 4 PROMOTE (ownership decision, re-run/concurrency bug, Cloudflare deploy facts, TS-scripts pattern), review-driven changes MERGED INTO PROPOSAL, propose-gate log lines DISCARDED to archive, 0 TODO (tier: solo — every entry has one dominant bucket)

## Review triage 2026-11-11
1. FIX — deploy.yml concurrency at workflow level (medium)
2. FIX — bootstrap verifies Cloudflare credentials before storing them (low)
3. FIX — deploy.yml DOPPLER_TOKEN comment accuracy (low)
4. FIX — deploy job re-checks tip of main (high; final-diff review #1)
5. FIX — account id checked before prerequisites (low)
6. FIX — multipart-abort lifecycle rule declared (low)
7. FIX — trust-boundary comment and deploy.md (low)
8. FIX — stale re-run skip is a warning; runbook; claims reworded (medium; fix-delta review #1)
9. FIX — exact pins on both tip-check skip blocks (low)
10. FIX — stale dispatch warns (low)
