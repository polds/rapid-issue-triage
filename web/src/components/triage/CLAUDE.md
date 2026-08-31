# web/src/components/triage/ — the triage screen

Everything the card deck renders. State comes from `useTriage()`
([`src/lib/store.tsx`](../../lib/CLAUDE.md)); these components own presentation
and their own local UI state only. The keyboard map itself lives in
[`src/pages/Triage.tsx`](../../pages/CLAUDE.md).

## Layout

| File | Role |
|---|---|
| `IssueCard.tsx` | The card: title, description, comments, labels, and the AI panel. Hosts `ClaudeMissingBanner` (shown when the server reports the `claude` binary absent). |
| `ActionBar.tsx` | Macro buttons + outcome variants. Digit keys map to macro **position**. |
| `QuickEditRow.tsx` | The `L E C P A X` quick edits. Exports two components: `QuickEditRow` (the buttons, rendered once per breakpoint) and `QuickEditPickers` (the modals, rendered **once** for the page). |
| `DeepPanel.tsx` | Deep enrichment UI: live per-scout progress, a Claude-Code-style thinking feed, the rendered report, and the raw action log dialog. |
| `report-format.ts` | `VERDICT_META` (label + tone per verdict) and the deep report → Linear markdown renderer. **Not a component** — split so `DeepPanel.tsx` stays fast-refresh clean. |
| `DuplicateOfPicker.tsx` | Prompts for the canonical issue. Linear requires the duplicate relation *before* the state change, so this blocks the apply. |
| `LabelGroupPrompt.tsx` | Replace-or-cancel when an action would add a second label from one exclusive Linear label group. Offers "Replace" only when the action adds exactly one sibling; otherwise it just explains the clash. |
| `FilterPanel.tsx` | Two distinct things: pick a saved Linear view (its filter becomes the **index** filter and triggers a reindex) vs. narrow the **local** queue view. Don't conflate them. |
| `TopBar.tsx` | Nav + `SyncPill` (fresh / stale / syncing / reindexing / error) + `VersionBadge` (the running build; becomes a link to the release when the background check finds a newer one). |
| `NotificationBell.tsx` | Background enrichment tracker; clicking an entry jumps to that issue. |
| `HelpOverlay.tsx` | The `?` overlay. **Must match the real keyboard map** and the README table. |
| `ShortcutBar.tsx` | Persistent hint strip. |
| `Confetti.tsx` | Celebration on a cleared queue. |

## Two filters, two meanings

This is the most common source of confusion in the UI:

- **Index filter** — the raw Linear `IssueFilter` deciding what the syncer
  indexes at all. Changing it rebuilds the index; the top bar shows
  *reindexing* and the queue is knowingly incomplete until it finishes.
- **View filter** — a local sqlite `WHERE` over the already-indexed rows
  (teams, labels, priorities, search). Instant, no sync involved.

`FilterPanel.tsx` presents both; `store.QueueFilter` implements the second and
`syncer`/`config` own the first.

## Verdicts

`actionable | likely_obsolete | possibly_done | needs_info | duplicate_suspect`
— a closed set shared with the backend. `VERDICT_META` in `report-format.ts` is
the presentation half; changing the set means touching `internal/ai`,
`internal/deep`, `internal/server/reportcomment.go`, and this file together.

## Invariants

- **Deep-run events arrive over SSE and are buffered in a ref**, not in state.
  `DeepPanel` reads them via `getRunEvents(runId)`; re-rendering per event
  would be unusable on a busy run. Render on a throttle or on status change.
- **A late-attaching panel replays from the server**, so it must render
  correctly starting from an arbitrary point in the stream — never assume it
  saw the `started` event.
- **The Claude-missing banner is driven by the server's live probe**, not by
  local config. It must offer the Settings path, not just report failure.
- **Issue text is rendered through `Markdown.tsx`**, never as HTML.
- **A portalled overlay is rendered once per page, never inside a component
  the layout duplicates.** `TriagePage` mounts the action row twice — below the
  card and in the `xl` rail — and hides one with responsive classes. Those
  classes cannot reach a `createPortal(…, document.body)` child, so a modal
  rendered from inside the row appears **twice**, stacked, each with its own
  state. That is why `QuickEditPickers` is separate from `QuickEditRow`; keep
  any new overlay out of the duplicated subtree too.
- **Pickers must not leak keystrokes.** `Triage.tsx` suppresses shortcuts
  while an `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` element has focus —
  a new overlay that captures typing needs to satisfy that check or `S` will
  skip the card mid-search.
- `formatReportComment` output is posted to Linear as a comment
  (`post_ai_report`); the Go side has its own renderer in
  `internal/server/reportcomment.go`. **The two are parallel implementations
  and drift silently** — change both.

## Maintenance

New component → the table above. New shortcut → `Triage.tsx` +
`HelpOverlay.tsx` + README. New report field → `report-format.ts`,
`DeepPanel.tsx`, `lib/types.ts`, and the backend schema in
[`internal/deep`](../../../../internal/deep/CLAUDE.md).
