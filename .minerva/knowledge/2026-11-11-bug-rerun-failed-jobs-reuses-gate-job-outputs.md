# "Re-run failed jobs" reuses a gate job's outputs, so the deploy job re-checks the tip

**Date**: 2026-11-11
**Type**: bug
**Theme**: deploy
**Summary**: A separate gate job's outputs are reused on re-run, so only a tip check inside the deploy job prevents a rollback.
**Context**: .minerva/work/2026-11-11-terraform-doppler-deploy (see git history if the worktree has been cleaned up)

## Context
`deploy.yml` first had one job under a workflow-level `concurrency: deploy` group. Review found that any run joins that group before its `if` or gate step decides anything, and a newer run cancels the group's pending run even with `cancel-in-progress: false`. So a run that would never deploy (a CI re-run of an old commit, a fork PR from a branch named `main`) could cancel the pending deploy of the tip.

## Finding
- The fix split the workflow into a `gate` job with no concurrency group and a `deploy` job with job-level `concurrency: deploy`, `needs: gate` and `if: needs.gate.outputs.deploy == 'true'`. A job skipped by its `if` never joins the group.
- That split introduced a rollback: **"Re-run failed jobs" does not re-run upstream jobs that succeeded; it reuses their outputs.** Re-running a failed deploy of commit B after C had deployed would have deployed B over C, because `needs.gate.outputs.sha` still said B.
- Fixed by re-checking `gh api repos/$REPO/commits/main` against the gated sha as the deploy job's first step, after the group is acquired.
- Residual, unavoidable while the outputs are reused: such a re-run still joins the group first and can displace a pending deploy of the tip before it stops itself. It warns, and the README runbook says to retry with `gh workflow run deploy.yml` instead.

## Implications
- Any check that must hold at deploy time belongs in the job that deploys, not only in an upstream job.
- Concurrency groups at workflow level apply before any job condition; put them on the job that does the serialized work.
- `tests/deploy-workflow.test.ts` pins both tip-check skip blocks exactly (deleting `exit 0` fails it).

## Related
- [[2026-11-11-decision-terraform-bindings-wrangler-worker-doppler-secrets]] — the concurrency group is what serializes the only Terraform writer
- [[2026-11-10-pattern-gates-pin-themselves]] — pins that a fail-open edit would pass are not pins
