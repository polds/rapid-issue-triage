# internal/linear — minimal Linear GraphQL client

Hand-written client for exactly the queries and mutations this tool needs.
No codegen, no SDK: the surface is small enough that a generated client would
cost more than it saves.

`https://api.linear.app/graphql`, 30s HTTP timeout, API key in `Authorization`.

## Layout

| File | Role |
|---|---|
| `client.go` | `Client`, `New`, `SetAPIKey`, `Do` (the single request/response path), GraphQL error unwrapping. |
| `api.go` | Every query and mutation, plus `paginate` and the `issueFields` fragment. |
| `types.go` | Wire structs: `Issue`, `Team`, `WorkflowState`, `Label`, `Project`, `Cycle`, `User`, `Comment`, `Ref`, `PageInfo`. |

## Invariants

- **The `Client` is a shared pointer, deliberately.** One instance is handed
  to the server, the syncer, and the deep toolbox. `SetAPIKey` takes a write
  lock and updates all three at once — that is how a key saved in Settings
  takes effect without a restart. Never copy the struct or hand out a clone.
- **`Do` is the only place an HTTP request is made.** Auth, JSON encoding,
  status handling, GraphQL `errors[]` unwrapping, and body truncation for
  error messages all live there. New operations are functions that call `Do`.
- **`issueFields` is the one issue projection.** Every issue query shares it,
  so `store.IssueRow` can be populated identically from any of them. Adding a
  field means adding it there and to `types.go` and `store.IssueRow`.
- **Nested objects are fetched as `{ id }` only** (`Ref`). Names come from the
  locally-indexed metadata tables, not from the issue payload — that keeps the
  issue query cheap and the index authoritative.
- **`paginate` follows `pageInfo.hasNextPage`** and is the only loop; no
  caller should hand-roll cursors. `filterTypeFor` picks the right filter
  input type per collection.
- **Filters are passed through verbatim.** `Issues` takes a
  `map[string]any` that is serialized straight into the GraphQL variable, so
  any [Linear IssueFilter](https://developers.linear.app/docs/graphql/filtering)
  the user writes in `rapid-triage.yaml` or pastes from a saved view works
  without this package knowing about it. Do not add validation here.
- **This package holds no policy.** No retries, no caching, no rate limiting,
  no business rules. Callers own those.

## Gotchas

- Linear returns HTTP 200 with a populated `errors[]` for most failures. `Do`
  already checks that — do not add a status-only success check.
- A duplicate relation must exist *before* an issue can enter a
  duplicate-type workflow state. `CreateDuplicateRelation` /
  `DeleteIssueRelation` exist for that ordering; see
  [`internal/server/ops.go`](../server/CLAUDE.md).
- Error bodies are truncated before being wrapped — Linear echoes the whole
  query on a parse error and it is unreadable otherwise.

## Maintenance

New operation → a function in `api.go` that calls `Do`, its structs in
`types.go`, and a row in the layout table only if a new file appears. Anything
that adds a field to an issue also touches `store.IssueRow`,
`syncer.toRow`, and `web/src/lib/types.ts`.
