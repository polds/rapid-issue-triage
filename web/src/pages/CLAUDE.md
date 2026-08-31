# web/src/pages/ — the four hash routes

One file per route, switched by `src/App.tsx` on `window.location.hash`.
Pages own layout and page-local state; anything shared lives in
[`src/lib/`](../lib/CLAUDE.md) or [`src/components/`](../components/CLAUDE.md).

| Page | Route | What it is |
|---|---|---|
| `Triage.tsx` | `#/` | The card deck. **Owns the global keyboard map** and renders `IssueCard` + `ActionBar` + `QuickEditRow`. |
| `Macros.tsx` | `#/macros` | Macro CRUD: name, key binding, outcome, and the ordered op list. |
| `Reports.tsx` | `#/reports` | Gamified stats: tiles, per-day bar chart, outcome donut, streaks. Charts are hand-rolled SVG — no chart library. |
| `Settings.tsx` | `#/settings` | Enrichment mode, per-source toggles with live availability, API keys, Advanced → Claude binary path, and About (build stamp + update check). |

## Triage — the keyboard contract

The keyboard map is the product. It is registered in `Triage.tsx` and
documented in three places that must agree: this page's handler,
`components/triage/HelpOverlay.tsx` (`?`), and the README's key table.

`←/→` prev/next · `S` skip · `Z` snooze 7d · `1–9` macro ·
`L E C P A X` label/estimate/cycle/project/assignee/status pickers ·
`Space` expand · `I` enrich · `O` open in Linear · `U` undo · `?` help.

- **Suppress shortcuts while a text input or picker has focus**, or typing a
  search term fires macros. Every new shortcut needs that guard.
- Digit keys map to macro *position*, not id.

## Macros — what an op is

A macro is an ordered list of `MacroStep`s, the same type the ad-hoc quick
edits use. Steps may reference labels/states **by name**, which the server
resolves per-issue-team at execution time — that is what makes one macro work
across every team. The editor must keep offering the name-based form; ID-only
macros silently stop working on other teams. Op kinds and resolution live in
[`internal/server/ops.go`](../../../internal/server/CLAUDE.md).

## Settings — invariants

- **Secret fields render for every source that declares one, regardless of
  whether that source is enabled.** Gating the inputs on `src.enabled` once
  left Datadog showing "set keys in Settings" with nowhere to set them.
- **The API never returns a secret value.** Rows show `{set, source, hint}`
  with a masked last-4; `source` tells the user whether the key came from
  Settings or the environment.
- **Availability is a live server probe**, not a guess from local state — a
  source can be enabled and unavailable (binary missing, key unset, repo path
  gone), and the UI must show the server's `detail` string verbatim.
- **Browse buttons call `POST /api/pick`.** The browser cannot produce a real
  filesystem path; the server opens a native dialog. A canceled dialog is not
  an error.
- Saving invalidates the `enrichmode` cache, or cards keep the old mode.
- **About renders whatever the server says, and decides nothing.** "Check now"
  asks `POST /api/version/check` to run the check early; whether an update
  exists is `update.available` from `internal/update`, never a comparison here.
  The card hides its controls entirely when the config disabled the check.

## Reports

Everything is aggregated by SQL in `store.Report`; this page only renders.
Push new statistics into the query, not into JavaScript.

## Maintenance

New page → the file here, the union in `App.tsx`'s `pageFromHash`, and a nav
entry in `components/triage/TopBar.tsx`. New shortcut → `Triage.tsx`,
`HelpOverlay.tsx`, and the README table, in one PR.
