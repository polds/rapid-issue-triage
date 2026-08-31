# internal/server — local HTTP API + embedded UI

Everything the browser can reach. One `http.ServeMux` on `127.0.0.1:7333`,
serving `/api/*` plus the `go:embed`ed SPA. No auth, no CORS, no TLS: the
listener is loopback-only by design, and that assumption is load-bearing for
`POST /api/toolbox` and `POST /api/pick`, which run subprocesses.

This is the only package that talks to *all* of `store`, `linear`, `syncer`,
`ai`, and `deep`. Business rules that outlive a request belong in those
packages, not here.

## Layout

| File | Role |
|---|---|
| `server.go` | `Server` struct, **the route table** (`Handler`), SPA fallback, `writeJSON`/`writeErr`/`decodeBody`/`bgCtx`. |
| `handlers.go` | Queue, meta, issues, apply/macro/skip/snooze, index-filter CRUD, Linear view + search proxies, macros CRUD, report, sync status, `PrefetchEnrichments`. |
| `ops.go` | `resolveOps` (name → ID resolution) and `applyOps` (the single Linear mutation), plus `undoActivity`. **The core of the write path.** |
| `labelgroups.go` | Linear label-group exclusivity: conflict detection, the replace resolution, and the messages both feed. |
| `deep.go` | Deep-run lifecycle: start, poll, SSE event stream, plain-text log, and the toolbox endpoint the scout shim calls. |
| `settings.go` | Enrichment settings, secret writes, the live `claude` probe (`ClaudeAvail`), native picker endpoint. |
| `pickfolder.go` | Native OS folder/file dialog as a subprocess. |
| `reportcomment.go` | Deep report → Linear-flavored markdown (`post_ai_report`). |
| `*_test.go` | Unit tests for the pure helpers (`canceled`, `linearIssueURL`). |

## Request → Linear write path

Every mutation — an ad-hoc quick edit or a whole macro — funnels through the
same two steps, so there is exactly one place that mutates an issue:

```
handleApply / handleRunMacro
  → resolveOps(issue, []Op)   // Op == store.MacroStep
       name-based refs (labelName, stateName, stateType, "active", "me")
       resolved against THIS issue's team → one IssueUpdateInput + a trace
  → applyOps
       snapshot prev field values → issueUpdate mutation → log Activity
```

- **`Op` is `store.MacroStep`** (type alias). Ad-hoc edits and macro steps are
  the same shape on purpose — anything a macro can do, a quick edit can do.
  Op kinds: `add_label`, `remove_label`, `set_state`, `set_estimate`,
  `set_project`, `set_cycle`, `set_assignee`, `add_comment`, `post_ai_report`.
- **Name-based resolution is per-issue-team**, which is what lets one macro
  work across every team. ID-based refs are exact and skip resolution.
- **Undo restores the pre-action snapshot** (`prev_json` on the activity row)
  in Linear *and* locally. Skips and snoozes are local-only and undo locally.
- **A duplicate-type state needs the relation first.** Linear rejects the
  state change otherwise, so `resolveOps` surfaces `duplicateOf` and the UI
  prompts for the canonical issue before applying.
- **Label groups are mutually exclusive.** `resolveOps` ends with
  `resolveLabelGroups`, which rejects a label set holding two children of one
  group rather than letting Linear answer `labelIds not exclusive child
  labels`. `opOptions.replaceGroupLabels` — set from the request after the user
  confirms — drops the sibling the issue already carried instead. Same shape as
  the duplicate flow: detect, prompt, re-run with the answer.

## Deep enrichment endpoints

`POST /api/issues/{id}/enrich/deep` starts a run; the UI then follows
`GET /api/enrich/runs/{id}/events` (SSE). Scouts reach the outside world only
by executing `triage-tool <tool> <args>`, which POSTs back to
`POST /api/toolbox` with a per-run token. See
[`internal/deep/CLAUDE.md`](../deep/CLAUDE.md) — that endpoint is the trust
boundary, and it must stay read-only and token-checked.

## Invariants

- **Add a route → add it to `Handler` in `server.go`.** That table is the
  API's index; keep it grouped by resource and in sync with
  [`web/src/lib/api.ts`](../../web/src/lib/CLAUDE.md).
- **`bgCtx()` for writes that must not be half-applied.** A user navigating
  away cancels the request context; a Linear mutation already in flight must
  still finish and still get logged.
- **The `claude` binary is probed per request** (`applyClaudeCommand` +
  `claudeStatus`), never cached at startup. Settings can change the path
  without a restart, and the enricher/orchestrator exist even when the binary
  is missing precisely so that works.
- **`writeActionErr`, not `writeErr`, for apply/macro.** A label-group clash is
  a 409 with `{code, conflicts, resolvable}` the UI prompts on; everything else
  stays a 502. A raw clash that slips past (a group created since the last sync)
  is rewritten by `exclusiveLabelHint` on the way out.
- **`writeIssueErr`, not `writeErr(w, 404, …)`, for every handler that loads
  the issue out of `r.PathValue("id")`.** A row the store cannot find is
  usually not a bad id: the syncer prunes issues that leave the index filter,
  and the browser's deck is a snapshot that can outlive one. It goes out as a
  404 `{code:"issue_gone"}` with an explanation, so the UI retires the card
  rather than reporting "Action failed: not found". Anything that is not
  `store.ErrNotFound` is a real fault and a 500.
- **Secrets are write-only over HTTP.** `PUT /api/secrets` accepts a value;
  no handler ever returns one. Responses carry `{set, source, hint}`.
- **`enriching` map guards duplicate concurrent enrichment per issue.** Hold
  `s.mu` only around the map, never across a Linear or Claude call.
- **The SPA fallback serves `index.html` for unknown paths** so `#/reports`
  and `#/macros` deep-link. Do not add a catch-all API route.
- `spaHandler` copies the request before rewriting `URL.Path` — mutating the
  caller's `*http.Request` is a data race.

## Gotchas

- `handlePick` shells out to osascript/zenity/PowerShell. It is reachable by
  any page the user's browser loads, which is acceptable only because the
  listener is loopback. Never bind `addr` to a non-loopback interface without
  revisiting this and `/api/toolbox`.
- Keep handlers under **gocyclo 15**. `resolveOps` is already near the cap:
  add a new op kind as a helper, not another branch inline.
- `errStopProbe` is a sentinel used to abort filter validation after the first
  page — an expected error, not a failure.

## Maintenance

New endpoint → route table + `web/src/lib/api.ts` + the payload type in
`web/src/lib/types.ts`. New op kind → `store.MacroStep`, `resolveOps`,
`applyOps`, `undoActivity`, and the macro editor in `web/src/pages/Macros.tsx`.
