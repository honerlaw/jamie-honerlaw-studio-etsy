## minerva

This project uses [minerva](https://github.com/honerlaw/agent-marketplace/tree/main/plugins/minerva) for durable record discipline.

- `.minerva/knowledge/` — write-once entries (decisions, bugs, patterns, constraints, references), each tagged with a `**Theme**` and a one-line `**Summary**`. Orient by listing the catalog — one `theme | entry | summary` line per entry, grouped by theme, with `(superseded)` on an entry a newer one has retired — then open only the entries whose theme bears on your task:

  ```sh
  find .minerva/knowledge -name '[0-9]*.md' -exec awk 'function p(){if(f!=""){n=f;sub(/.*\//,"",n);sub(/\.md$/,"",n);N[++c]=n;T[n]=(t==""?"(unthemed)":t);S[n]=s;if(b)X[n]=1};f=FILENAME;t="";s="";q=0;r=0;h=0;b=0} function id(x){sub(/.*\//,"",x);sub(/-[a-z]+-.*/,"",x);return x} function tgt(x){sub(/^- \[\[/,"",x);sub(/\]\].*/,"",x);return x} FNR==1{p()} {sub(/\r$/,"")} /^[ \t]*(```|~~~)/{q=!q;next} q{next} /^## /{h=1;r=($0=="## Related")} !h&&/^<!-- superseded-by: /{b=1} /^\*\*Theme\*\*:/&&t==""{sub(/^\*\*Theme\*\*:[ \t]*/,"");sub(/[ \t]+$/,"");t=$0} /^\*\*Summary\*\*:/&&s==""{sub(/^\*\*Summary\*\*:[ \t]*/,"");sub(/[ \t]+$/,"");s=$0} r&&/^- \[\[[^]]*\]\][ \t]*(—|–|-)[ \t]*/&&!/\]\].*\[\[/{l=tolower($0);sub(/^- \[\[[^]]*\]\][ \t]*(—|–|-)[ \t]*/,"",l);x=tgt($0);if(l~/^superseded by([ \t]*(:|;|,|—|–|-)|[ \t]*$)/)b=1;else if(l~/^supersedes([ \t]*(:|;|,|—|–|-)|[ \t]*$)/&&id(f)>=id(x))Y[x]=1} END{p();for(i=1;i<=c;i++){n=N[i];print T[n]" | "n" | "S[n]((n in X)||(n in Y)?" (superseded)":"")}}' {} + | sort
  ```

  Links between entries are forward-only `## Related` lines; find what links *to* an entry with `grep -l '\[\[<entry>\]\]' .minerva/knowledge/*.md`.
- `.minerva/reference/` — present-tense operational docs (architecture, glossary, conventions): how the system works now. Read on demand.
- `.minerva/work/` — historical proposals and replans. Grep when you need the reasoning behind a past feature.

Active work units live at `.minerva/work/<date-slug>/`. Load the installed `minerva:using-minerva` skill for the full methodology using your host's skill loader. In Claude Code use `/minerva:using-minerva`; in Codex select `$minerva:using-minerva`. Follow the loaded plugin's runtime contract for tools and installed paths.

