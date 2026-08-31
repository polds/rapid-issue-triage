# web/src/lib/ — state, transport, types, pure helpers

Everything the UI runs on that isn't a component. Split so that the pure
modules can carry a real coverage floor: **`utils`, `colors`, `linear`,
`linearfilter`, `enrichmode`, `labelgroups`, `notices` are the only files in
`vitest.config.ts`'s coverage `include`** (90% statements/functions/lines, 85%
branches). New pure logic belongs here with a test, not inline in a component.

## Layout

| File | Role | Tested |
|---|---|---|
| `store.tsx` | `TriageProvider` — metadata, macros, the card deck, and every triage action. The app's single source of truth. | — |
| `triage-context.ts` | The context object, `useTriage`, and the deck types (`Card`, `CardStatus`, `Swipe`, `EnrichNotice`). Split out so `store.tsx` exports only components. | — |
| `api.ts` | Thin `fetch` wrapper over the Go API. `ApiError` carries the server's `{error}` message, plus `code`/`conflicts` for the failures the UI acts on (`label_group_conflict` → replace prompt, `issue_gone` → retire the card). **The one place a response is asserted into a type.** | — |
| `types.ts` | Every wire type, mirroring the Go JSON tags. `EMPTY_FILTER`, `filterIsEmpty`. | — |
| `theme.tsx` | Light/dark provider, persisted. | — |
| `utils.ts` | `cn` (clsx + tailwind-merge), `timeAgo`, `fmtMs`, `PRIORITY_NAMES`. | ✔ |
| `colors.ts` | Stable hue per team key (hashed → oklch); Linear label hex passthrough with a muted fallback. | ✔ |
| `linear.ts` | `linearIssueHref` — build an issue URL from an identifier using the current issue's URL as a template. | ✔ |
| `linearfilter.ts` | `decodeLinearFilterURL` — base64url `?filter=` from a linear.app view URL → `IssueFilter` JSON. | ✔ |
| `enrichmode.ts` | Module-level cache of enrichment settings so every card doesn't refetch. | ✔ |
| `labelgroups.ts` | Pre-flight for Linear's mutually exclusive label groups: which groups a set of ops would put two labels into, and how to say so. | ✔ |
| `notices.ts` | How an `EnrichNotice` reads: `noticeIsActive` (queued **or** running — the one definition every consumer shares), plus the dropdown's detail and timestamp lines. | ✔ |

## `store.tsx` — the contract

Optimistic, deck-shaped state:

- **Actions animate first, then reconcile.** `swipeAway` moves the card
  immediately (300ms) while the Linear call runs; a failure rolls the card
  back and raises an error toast. Never make the UI wait on the network.
- **The deck streams.** `fetchMore` pulls batches of 25 excluding cards
  already held, so the queue keeps filling as the background sync lands rows.
- **Undo is a stack of activity ids.** `pushUndo` records what the server can
  reverse; the server owns the actual restore.
- **Deep runs are watched, not polled.** `startWatcher` opens the SSE stream,
  buffers events in a ref (`getRunEvents`), and drives the notification bell.
  Events live in a ref, not state — re-rendering per event would be unusable.
- **A notice is the client's whole record of a run**, so `noticeIsActive`
  (from `notices.ts`) is load-bearing in three places at once: `activeRun`
  reads it to decide what the card shows, `dismissNotice`/`clearDoneNotices`
  refuse to drop an active one, and `enrich` refuses to queue a second run for
  a card that already has one — a pooled run can wait minutes, and without
  that guard every extra keypress lands another run at the back of the line.
- **`labelGroupConflicts` gates the label-replace flow**, the same way
  `needsDuplicateOf` gates the duplicate one: it runs against synced metadata
  before the request, so a clash raises its prompt with no round trip and no
  card swipe to undo. It is a *pre-flight*, not the rule —
  `internal/server/labelgroups.go` re-checks and is the authority. Both must
  keep the same `labelsChanged` guard: with no label op the update carries no
  `labelIds`, so a group the issue already violated is not that action's fault.
- **`needsDuplicateOf` gates the duplicate flow.** Linear requires the
  relation before a duplicate-type state change, so the provider raises a
  prompt instead of applying.
- `duration()` times each card from first view, feeding the reports page.

## Invariants

- **A module that exports a component exports only components** — that is why
  `triage-context.ts` is separate from `store.tsx`. ESLint enforces it as an
  error. Do the same for any new context or hook.
- **`req()` in `api.ts` decodes into `unknown` and asserts once.** No `any`
  escapes into callers, and the `no-unsafe-*` rules are on to keep it that
  way. Add new endpoints as methods on `api`, never a bare `fetch`.
- **`types.ts` mirrors Go struct tags and nothing verifies it.** Change a Go
  JSON tag → change it here in the same PR.
- **`enrichmode` must never cache a rejected promise.** The in-flight slot is
  cleared on failure; otherwise one bad request (server restarting) bricks
  every later call. The Settings page invalidates the cache on save.
- **Pure modules stay pure** — no React, no `fetch`, no `Date.now()` in a
  return value that a test would have to freeze. That is what makes the
  coverage floor meaningful.
- `decodeLinearFilterURL` parses untrusted pasted input: it must throw a
  readable `Error`, never return a partial object. Its tests feed it hostile
  fixtures (that's why `no-script-url` is off in test files).

## Maintenance

New endpoint → `api.ts` + `types.ts` + the Go route table. New pure helper →
its own file here, a `.test.ts` beside it, and add it to `vitest.config.ts`'s
coverage `include` (a helper outside that list is invisible to the floor).
