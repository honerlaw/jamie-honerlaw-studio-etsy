## minerva

This project uses [minerva](https://github.com/honerlaw/agent-marketplace/tree/main/plugins/minerva) for durable record discipline.

- `.minerva/knowledge/` — write-once entries (decisions, bugs, patterns, constraints, references), each tagged with a `**Theme**` and a one-line `**Summary**`. Orient by listing the catalog — one `theme | entry | summary` line per entry, grouped by theme, with `(superseded)` on an entry a newer one has retired — then open only the entries whose theme bears on your task:

  ````sh
  find .minerva/knowledge -name '[0-9]*.md' -exec awk 'function p(){if(f!=""){n=f;sub(/.*\//,"",n);sub(/\.md$/,"",n);N[++c]=n;T[n]=(t==""?"(unthemed)":t);S[n]=s;if(b)X[n]=1};f=FILENAME;t="";s="";q=0;r=0;h=0;b=0} function id(x){sub(/.*\//,"",x);sub(/-[a-z]+-.*/,"",x);return x} function tgt(x){sub(/^- \[\[/,"",x);sub(/\]\].*/,"",x);return x} FNR==1{p()} {sub(/\r$/,"")} /^[ \t]*(```|~~~)/{q=!q;next} q{next} /^## /{h=1;r=($0=="## Related")} !h&&/^<!-- superseded-by: /{b=1} /^\*\*Theme\*\*:/&&t==""{sub(/^\*\*Theme\*\*:[ \t]*/,"");sub(/[ \t]+$/,"");t=$0} /^\*\*Summary\*\*:/&&s==""{sub(/^\*\*Summary\*\*:[ \t]*/,"");sub(/[ \t]+$/,"");s=$0} r&&/^- \[\[[^]]*\]\][ \t]*(—|–|-)[ \t]*/&&!/\]\].*\[\[/{l=tolower($0);sub(/^- \[\[[^]]*\]\][ \t]*(—|–|-)[ \t]*/,"",l);x=tgt($0);if(l~/^superseded by([ \t]*(:|;|,|—|–|-)|[ \t]*$)/)b=1;else if(l~/^supersedes([ \t]*(:|;|,|—|–|-)|[ \t]*$)/&&id(f)>=id(x))Y[x]=1} END{p();for(i=1;i<=c;i++){n=N[i];print T[n]" | "n" | "S[n]((n in X)||(n in Y)?" (superseded)":"")}}' {} + | sort
  ````

  Links between entries are forward-only `## Related` lines; find what links _to_ an entry with `grep -l '\[\[<entry>\]\]' .minerva/knowledge/*.md`.

- `.minerva/reference/` — present-tense operational docs (architecture, glossary, conventions): how the system works now. Read on demand.
- `.minerva/work/` — historical proposals and replans. Grep when you need the reasoning behind a past feature.

Active work units live at `.minerva/work/<date-slug>/`. Load the installed `minerva:using-minerva` skill for the full methodology using your host's skill loader. In Claude Code use `/minerva:using-minerva`; in Codex select `$minerva:using-minerva`. Follow the loaded plugin's runtime contract for tools and installed paths.

## Project conventions

This repository is a remote MCP server (TypeScript on Cloudflare Workers) for managing one Etsy shop. The design and its phases live in `.minerva/work/2026-11-10-etsy-shop-mcp-server/proposal.md`. Etsy API facts live in `.minerva/reference/etsy-api.md`.

**The gates are the only review a PR gets** (the `main` ruleset requires the `ci-pass` check with 0 approvals). Run them all before pushing:

```sh
npm run typecheck && npm run lint && npm run format:check && npm run knip && npm test && npm run build && npm run check:etsy-types && npm run check:worker-types && npm run check:infra
```

Rules:

- **Never weaken a gate to make a change pass.** That covers tsconfig flags, ESLint rules, coverage thresholds (90% global, 80% per file), the `ci-pass` needs list and the ruleset. `tests/gate-integrity.test.ts` pins all of them. Editing it to loosen a gate needs an explicit, owner-approved reason in the PR.
- **Every lint suppression carries a description** (`-- why`), and blanket disables are rejected. Prefer fixing the code. A platform contract that forces an exception belongs in a named carve-out block in `eslint.config.ts`, not an inline disable.
- **One exported function per file** in `src/` (`agentic/one-export-per-file`). The filename matches the export.
- **No `console`** outside the logger module. No TS `enum` or `namespace`. No default exports except `src/index.ts`.
- **Generated files are never hand-edited:** `src/etsy/generated/schema.ts` (`npm run gen:etsy-types`) and `worker-configuration.d.ts` (`npm run gen:worker-types`, rerun after any `wrangler.jsonc` change).
- **Add a dependency in the PR that first uses it** (knip rejects unused ones). Pin exact versions.
- **Hard-to-reach branches** (crypto and storage failures, time) are tested through injectable interfaces, not excluded from coverage.
- Tests that run Worker code go in `test/` (workerd). Repo-level checks go in `tests/` (Node), and tests of the TypeScript scripts in `scripts/` go in `tests/scripts/`.
- **Production is deployed only by `.github/workflows/deploy.yml`** (`.minerva/reference/deploy.md`). Never run `terraform apply`, `terraform import` or `wrangler deploy` against production by hand; change `infra/` or Doppler and let the workflow apply it.
