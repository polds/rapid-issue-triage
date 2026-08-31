# internal/store — sqlite: the only persistence layer

Owns `~/.rapid-triage/triage.db` and every schema statement in the project.
Nothing else in the tree opens a database, writes SQL, or knows a table name.
The UI is always served from here — never straight from Linear — so a slow or
down Linear API degrades to *stale*, never to *broken*.

Pure data access: no HTTP, no Linear client, no goroutines. Callers hand in
already-fetched values (`internal/syncer` inside its own transaction,
`internal/server` per request).

## Layout

| File | Role |
|---|---|
| `store.go` | `Open`, connection pragmas, **`schema` (all DDL)**, `migrate`, `SetMeta`/`GetMeta`, `now()`. |
| `models.go` | View models serialized straight to the frontend: `IssueRow`, `Enrichment`, `Macro`, `MacroStep`, `Activity`, `LabelChip`. |
| `issues.go` | Issue index + queue: `UpsertIssue`, `PruneStale`, `Queue`, skip/snooze/triage marks, `RestoreIssue`, issue context cache. |
| `metadata.go` | Replace-all upserts for teams/states/labels/projects/cycles/users + name→ID lookups (`LabelIDByName`, `StateIDByType`, `ActiveCycleID`, `MyUserID`, `LabelGroupsFor`). |
| `queuefilter.go` | `QueueFilter` → SQL `AND` fragments + bind args. Local view narrowing only. |
| `macros.go` | Macro CRUD. |
| `activity.go` | Append-only action log, undo bookkeeping, and `Report` (the aggregation behind the reports page). |
| `enrichments.go` | Fast-enrichment cache keyed by issue, stamped with `IssueContentHash`. |
| `enrichruns.go` | Deep-run rows + their full event stream (`EnrichRun`, `EnrichEvent`). |
| `enrichsettings.go` | `EnrichSettings` (mode, per-source toggles, `claudePath`) — one JSON blob in `meta`. |
| `tokenusage.go` | `token_usage` rows + `TokenUsageReport` (the AI-spend half of the reports page). Write-once; nothing reads a row back individually. |
| `secrets.go` | `Secrets` in `meta`, and `Resolve` — the Settings → env → `.env` precedence chain. |
| `*_test.go` | Unit tests. This package and `internal/config` carry the **70% coverage floor** (`make cover-go`). |

## Invariants

- **All DDL lives in the `schema` const in `store.go`**, wrapped in
  `CREATE TABLE IF NOT EXISTS`. Adding a column to an existing table means a
  second, additive `ALTER TABLE` in `migrate()` whose error is deliberately
  ignored (`_, _ =`) — the database ships on user machines and is never
  recreated. Never write a destructive migration.
- **One writer connection.** `db.SetMaxOpenConns(1)`; modernc sqlite is
  happiest that way. Do not raise it to "fix" a lock error.
- **`sync_gen` is the tombstone mechanism.** Each sync stamps every row it
  writes with a generation, then `PruneStale(gen)` deletes everything older.
  An issue that fell out of the upstream filter disappears that way.
- **`UpsertIssue` clears `triaged_at`.** If Linear still returns an issue
  under the untriaged filter, it belongs back in the queue — even if this tool
  triaged it before.
- **Local-only columns survive a sync**: `skip_count`, `snoozed_until`. Skips
  and snoozes never reach Linear.
- **Queue order is `skip_count ASC, RANDOM()`** — skipped issues sink, and
  ties shuffle so the same card doesn't reappear first every session.
- **`IssueContentHash` covers title + description only.** Our own triage
  mutations (labels, state) must not invalidate an analysis of what the issue
  *says*.
- **Secrets never leave this package in the clear.** The API surface exposes
  `SecretStatus()` → `{set, source, hint}` with a masked last-4. `Resolve(id)`
  is the only accessor that returns a value, and its order is
  **Settings → env → `.env`** (via `config.Lookup`).
- **`Report` is SQL, not Go.** Streaks, per-day buckets, and outcome
  breakdowns are aggregated in the query; the frontend only renders. Its
  `tokens` key is `TokenUsageReport`, aggregated the same way.
- **`token_usage` is append-only and never joined.** A row records what one
  LLM call spent and which agent spent it; it deliberately does not reference
  `issues`, so `PruneStale` deleting an issue cannot rewrite spend history.
  `RecordTokenUsage` drops calls that reported nothing rather than storing
  zero rows, which would inflate the call count.
- Times are RFC3339 UTC strings (`now()`), not sqlite date types.

## Gotchas

- Go 1.27 rejects `QueueFilter{}.Empty()` (struct-literal field selector).
  Write `(QueueFilter{}).Empty()`.
- `errRow` maps `sql.ErrNoRows` to a `not found` error — handlers rely on it
  for 404s. Don't return the raw driver error.
- `golangci-lint` excludes only `G202` (SQL string concat) under this path.
  Concatenation is confined to `issueCols` and the generated `?` placeholder
  lists; **every user value stays a bind arg**. Keep it that way.

## Maintenance

Adding a table or column → `schema` **and** `migrate()`, plus a row in the
layout table above. Changing anything in `models.go` → mirror it in
[`web/src/lib/types.ts`](../../web/src/lib/CLAUDE.md); the JSON tags are the
wire contract and nothing validates the two sides against each other.
