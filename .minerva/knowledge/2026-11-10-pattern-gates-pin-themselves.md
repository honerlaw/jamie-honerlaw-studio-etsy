# With zero required approvals, the merge gates pin themselves in tests

**Date**: 2026-11-10
**Type**: pattern
**Theme**: toolchain
**Summary**: Gate config is pinned by tests so loosening any gate requires visibly editing a test.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
This repo is mostly agent-written, and `main` merges on a green `ci-pass` with 0 approvals plus auto-merge. The gates are the only review a PR gets, so an agent could "fix" a failure by weakening a gate in the same PR, and nothing would notice.

## Finding
The gates are pinned by Node-side tests that run inside the gate itself:
- `tests/gate-integrity.test.ts` pins:
  - the strict tsconfig flags, and that `tsconfig.node.json` only changes `lib` and `types`;
  - `--max-warnings 0`;
  - coverage at ≥90% global and the 80% per-file floor script with its metrics;
  - the `ci-pass` needs set;
  - the ruleset JSON (no bypass, deletion, non_fast_forward, and `ci-pass` bound to `integration_id` 15368, which is GitHub Actions, so a forged commit status can't satisfy it);
  - every named lint rule at `error`, via `ESLint.calculateConfigForFile` for src/, tests/ and scripts/.
- `tests/ci-structure.test.ts` checks that `ci-pass` needs every job, and that no job or step has an `if:`, `continue-on-error` or an `|| true`-style swallow. It also checks that each job runs its command.
- `tests/lint-gate.test.ts` lints fixtures that each guarded rule must flag.
- `tests/check-scripts.test.ts` proves the coverage-floor and generated-types scripts can fail. The floor script fails closed on an unexpected shape.

## Implications
- Loosening a gate is possible, but it is a visible edit to one of these tests in the same PR, which a human reading the PR will see.
- A new gate (a CI job, a lint rule, a threshold) is incomplete until it is pinned here too.
- A gate script that can't be shown to fail is not a gate. Test the failure path.

## Related
- [[2026-11-10-constraint-import-x-needs-typescript-resolver-and-parsers]] — an example of a gate that passed while doing nothing
