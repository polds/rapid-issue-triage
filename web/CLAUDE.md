# web/ — the embedded frontend

Vite + React 19 + Tailwind v4 SPA. `npm run build` writes `web/dist/`, which
`webui.go` embeds into the Go binary with `go:embed` — **`web/dist/` is
committed** so `go build` works without Node. A UI change is not shipped until
`make build` (or `npm run build`) has regenerated it.

Dependency-light on purpose: no router, no state library, no component
framework, no markdown library. Adding one needs a reason in the PR.

## Layout

| Path | Contents | Deep doc |
|---|---|---|
| [`src/lib/`](src/lib/CLAUDE.md) | Global state, fetch wrapper, wire types, pure helpers. **The tested half.** | ✔ |
| [`src/components/`](src/components/CLAUDE.md) | Shared components (`Markdown`, `ErrorBoundary`, `PriorityIcon`) + the `triage/` and `ui/` trees. | ✔ |
| [`src/pages/`](src/pages/CLAUDE.md) | The four hash routes: Triage, Macros, Reports, Settings. | ✔ |
| `src/App.tsx` | Hash → page switch. Adding a page means editing `pageFromHash` **and** the union in it. |
| `src/main.tsx` | Provider stack: `ThemeProvider > ToastProvider > ErrorBoundary > App`. Order matters — toasts must survive a render crash. |
| `src/styles.css` | Tailwind v4 entry + the design tokens (~134 CSS vars) + keyframes. All theming is tokens; components use `var(--…)`, never raw hex. |
| `dist/` | Build output, **committed**, embedded by `webui.go`. Never hand-edit. |
| `eslint.config.js` | Flat config. Every non-obvious rule carries a written reason; the React Compiler rules from `eslint-plugin-react-hooks` v7 were adopted one PR at a time and are now all on. |
| `vitest.config.ts` | Node env; **coverage floor scoped to the pure `src/lib` modules** (90/85/90/90), mirroring how the Go floor is scoped. |

## Routing

Hash-based (`#/`, `#/macros`, `#/reports`, `#/settings`), no router
dependency. The Go server's SPA fallback serves `index.html` for unknown
paths so deep links work. Keep it that way — a history router would need
server route changes.

## Conventions

- **`@/` aliases `src/`** in both `vite.config.ts` and `vitest.config.ts`.
  Both must be updated together.
- **A module that exports a component exports *only* components.** ESLint's
  `react-refresh/only-export-components` is an **error**, which is why
  `lib/triage-context.ts`, `components/ui/use-toast.ts`, and
  `components/triage/report-format.ts` exist as separate files. Put a new
  context, hook, or constant in a sibling `.ts`, not next to a component.
- **No `any`, and no unsafe access.** The `no-unsafe-*` family is on:
  `req()` in `lib/api.ts` decodes into `unknown` and asserts the response
  shape in exactly one place. Keep the assertion there, not at call sites.
- **Fire-and-forget must be spelled `void`** (`no-floating-promises` is an
  error) — or a real `.catch()` where the user should see the failure.
- **Never render Linear-authored text as HTML.** `no-eval`/`no-new-func`/
  `no-script-url` are errors, and `components/Markdown.tsx` is hand-written
  precisely so no `dangerouslySetInnerHTML` exists in the tree.
- **Render must be pure** (`react-hooks/purity`): no `Date.now()` or
  `Math.random()` in a render body — use an effect, a lazy `useState`
  initialiser, or a handler.
- **No component declared inside another component**
  (`react-hooks/static-components`) — it remounts the subtree every render.
- **No `setState` in an effect body** (`react-hooks/set-state-in-effect`). It
  costs a second render pass and usually means the value should be derived
  during render or updated by the event that causes it. Effects are for
  syncing with the outside world.

All of the v7 React Compiler rules are now enabled — there is no deferred
list left. Adopting each one was a rendering change landed on its own, so if
a new rule ever needs deferring, turn it off with a written reason in
`eslint.config.js` rather than dropping it silently.

## Commands

```sh
npm run dev        # :5173, proxies /api → 127.0.0.1:7333
npm run build      # tsc -b && vite build → dist/   (required before go build)
make web-ci        # eslint + vitest w/ coverage floor + build — what CI gates
```

## Maintenance

Changing a payload shape → `src/lib/types.ts` **and** the Go struct tags it
mirrors ([`internal/store/models.go`](../internal/store/CLAUDE.md) or the
handler's response type). Nothing checks the two sides agree. Rebuild `dist/`
in the same commit as any UI change — and conversely, `npm run build` rewrites
the hashed bundle and `index.html` even when nothing changed, so revert
`web/dist/` before committing unrelated work.
