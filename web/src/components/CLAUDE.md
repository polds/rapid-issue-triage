# web/src/components/ — shared components + two subtrees

Three genuinely app-wide components live here; everything else is grouped.

| File | Role |
|---|---|
| `Markdown.tsx` | Hand-written, dependency-free renderer covering what Linear descriptions and comments actually use (headings, lists, code, links, tables, images). **Deliberately not a library.** |
| `ErrorBoundary.tsx` | Catches render crashes below it and shows the error instead of a blank page. Mounted above `App` in `main.tsx`. |
| `PriorityIcon.tsx` | Linear's priority scale: `0` none, `1` urgent, `2` high, `3` medium, `4` low. Don't re-derive that mapping elsewhere. |

| Subtree | Contents | Deep doc |
|---|---|---|
| [`triage/`](triage/CLAUDE.md) | The triage screen's components — card, action bar, quick edit, deep panel, filter panel, top bar, bell. | ✔ |
| [`ui/`](ui/CLAUDE.md) | The small primitive kit: button, dialog, picker, select, toast. | ✔ |

## Why `Markdown.tsx` is hand-written

Issue bodies and comments are **untrusted, Linear-authored text**. A markdown
library would pull in an HTML pipeline and the temptation of
`dangerouslySetInnerHTML`; there is none in this tree and ESLint bans the
adjacent escape hatches (`no-eval`, `no-new-func`, `no-script-url`). The
renderer emits React elements only. If it can't render some construct, add a
case — do not swap in a library.

Link handling is the sharp edge: only `http(s)` hrefs may be emitted, and a
`javascript:` URL must render as text.

The other sharp edge is the tokenizer regex itself. Every alternative is
bounded by a negated class that excludes its own opening delimiter, so no
start position can scan past the next one. The link target used `[^)]+`, which
was not bounded that way: on `"[a](".repeat(n)` — text a Linear description
can plainly contain — it rescanned to end-of-string from every `[`, quadratic,
~2.5s at 160KB. The cost of the fix is that a link target containing a space
or a paren now renders as text instead of a link. That is the right side of
the "not a full spec implementation" trade. `sonarjs/super-linear-regex` is
what guards it now; do not silence it here.

## Conventions

- **Styling is Tailwind classes over the tokens in `src/styles.css`.** Use
  `var(--…)` for colors; no raw hex in a component.
- **Compose classes with `cn()`** from `@/lib/utils` so conditional classes
  merge instead of fighting.
- **A component file exports only components.** Constants, contexts, hooks,
  and formatters go in a sibling `.ts` — that's why `ui/use-toast.ts` and
  `triage/report-format.ts` exist. ESLint enforces it as an error.
- **No component defined inside another component** (`react-hooks/static-components`):
  it gets a new identity every render and React remounts its subtree, losing
  DOM state. Hoist it to module scope.
- **No `Date.now()`/`Math.random()` in a render body** (`react-hooks/purity`).
  `Confetti.tsx` is the case to imitate: randomness is generated in an effect
  or a lazy initialiser, never inline.
- Components read state through `useTriage()`; they should not `fetch`
  directly. The exception is a component that owns a genuinely local,
  page-invisible query.

## Maintenance

A component that grows page-specific logic belongs in `triage/` or in the
page. A component reused by two subtrees belongs here. Update the table above
when a file lands in this directory.
