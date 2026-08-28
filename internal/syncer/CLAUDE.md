# internal/syncer — background Linear → sqlite indexer

One goroutine, started by `cmd/triage` and stopped by context cancellation.
It refreshes workspace metadata and every issue matching the active filter on
a ticker (`sync.interval`, default 10m) and on demand (`Kick`).

**The UI never waits on this.** Handlers read sqlite, stale or not, and the
`Status` it exposes is what drives the freshness pill in the top bar.

## Layout

Single file, `syncer.go`: `Syncer`, `Run`, `Kick`, `Status`, `ActiveFilter`,
`DefaultFilter`, `doSync`, `syncOnce`, the per-collection `write*` helpers,
and `toRow` (Linear `Issue` → `store.IssueRow`).

## How one sync works

```
syncOnce (10m ceiling)
  ├ viewer, teams, states, labels, projects, cycles, users   → replace-all in one tx
  ├ issues, paginated under the active filter                → UpsertIssue(gen)
  └ PruneStale(gen)                                          → delete anything older
```

- **Generation counter, not diffing.** Every row written gets the run's `gen`;
  anything left behind fell out of the upstream filter and is deleted. There
  is no delete feed from Linear to subscribe to.
- **Metadata is replace-all inside the caller's transaction.** The tables are
  small; wholesale replacement avoids reconciling renames and deletions.
- **`toRow` is the mapping seam.** Linear nested objects collapse to IDs;
  names are resolved later from the metadata tables.

## Invariants

- **Only one sync runs at a time.** `doSync` returns immediately if `syncing`
  is set. `Kick` is therefore always safe to call from a handler.
- **A sync never blocks a request.** No handler may call `syncOnce`; call
  `Kick` and let the UI keep serving the index.
- **The mutex guards status fields only** — never hold it across a Linear
  call.
- **`Reindexing` means the filter changed.** When the active index filter
  differs from the one the last completed sync used, the index is being
  rebuilt and the queue is knowingly incomplete; the UI says so rather than
  pretending the data is current.
- **`Stale` is derived, not stored** — computed in `Status()` from
  `LastSyncedAt` against the interval.
- **Local triage state is never overwritten** — that contract lives in
  `store.UpsertIssue` (preserves `skip_count`/`snoozed_until`, clears
  `triaged_at`). Read [`internal/store/CLAUDE.md`](../store/CLAUDE.md) before
  changing what a sync writes.
- Errors are recorded in `Status.LastError` and logged, never fatal. A failed
  sync leaves the previous index intact.

## Maintenance

Changing what a sync fetches → `syncOnce` + a `write*` helper + the matching
`Replace*` in `internal/store/metadata.go`. Changing the issue shape →
`toRow` + `store.IssueRow` + `internal/linear/api.go`'s `issueFields`.
