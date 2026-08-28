# internal/deep — multi-agent deep enrichment

Fans out read-only "scout" agents across the sources the user enabled, streams
every thought and tool call as it happens, then synthesizes one fixed-schema
report. Orchestration is Go; the LLM only reasons.

The alternative to this package is [`internal/ai`](../ai/CLAUDE.md) — one
Claude call, no tools, no streaming. Settings picks between them
(`EnrichSettings.Mode` = `fast` | `deep`).

## Layout

| File | Role |
|---|---|
| `orchestrator.go` | `Orchestrator`: run lifecycle, scout fanout, event fan-out to SSE subscribers, synthesis, persistence. The shim is installed here. |
| `scouts.go` | One prompt per source + `issueContext` + the synthesis prompt (**which defines the report JSON schema**). |
| `toolbox.go` | `Probe` (what's actually usable on this machine) and `Call` (the read-only tool implementations). |
| `claude.go` | `claudeStream`: runs `claude -p --output-format stream-json --verbose` and forwards each assistant thought / tool call / tool result to a callback. |

## The credential boundary (the point of this package)

**Scouts never hold credentials, and never call an API directly.**

```
scout agent (claude, sandboxed PATH)
  └─ exec `triage-tool linear.search foo`         ← shim on PATH, no secrets
       └─ POST /api/toolbox {token, agent, tool, args}
            └─ Orchestrator.ValidateToken(token)  ← maps token → run
                 └─ Toolbox.Call(tool, args)      ← reads secrets, executes
                      └─ logged as a tool_call event, then returned
```

- The shim is a 2-line `sh` script written to a temp dir at
  `NewOrchestrator` time and prepended to each scout's `PATH`. It re-execs
  *this same binary* as `triage tool …` (see
  [`cmd/triage`](../../cmd/triage/CLAUDE.md)).
- The shim carries `RT_TOOLBOX_URL` / `RT_RUN_TOKEN` / `RT_AGENT` in its env.
  The token is minted per run and expires with it.
- `Toolbox.Call` dispatches on `"<source>.<verb>"` and **every implementation
  is read-only**: `linear.search`, `linear.issue`, `github.search-prs`,
  `github.search-code`, `github.pr`, `datadog.logs`, `datadog.monitors`,
  `gcloud.run`. Adding a verb that writes anything breaks the contract the
  Settings UI advertises to the user.
- `Toolbox.resolve` prefers a Settings-stored secret over the environment and
  returns the *source* alongside the value, so the UI can say where a key came
  from without ever seeing it.

## Run lifecycle

`Start` → row in `enrich_runs` (status `running`) → goroutine:

1. `Probe(settings)` → `Availability` per source (binary present? key set?
   repo paths exist?).
2. `enabledScouts` = enabled **and** available. Zero → the run fails fast with
   "no enabled+available sources; open Settings".
3. Scouts run against `claudeStream`; every event is persisted to
   `enrich_events` *and* broadcast to SSE subscribers.
4. Synthesis: all scout outputs → `synthesisPrompt` → strict JSON report.
5. `finish` writes the report, flips status, and caches the verdict as a
   normal `Enrichment` so the card shows it without re-running.

## Invariants

- **Every event is persisted before it is broadcast.** A browser that attaches
  late replays from sqlite; live subscribers get the tail. Runs stay in memory
  ~10 minutes after finishing for late SSE attach, then drop.
- **Orphaned runs are failed at startup.** `FailOrphanRuns` marks runs left
  `running` by a previous process, or the UI waits on them forever.
- **The synthesis prompt is the schema.** `verdict` is one of
  `actionable | likely_obsolete | possibly_done | needs_info | duplicate_suspect`.
  Changing the shape means changing, in the same PR: `synthesisPrompt`,
  `store.Enrichment`, `DeepReport` in `web/src/lib/types.ts`,
  `web/src/components/triage/report-format.ts`, and
  `internal/server/reportcomment.go`. Nothing checks these agree.
- **Tool payloads are capped** (`capRaw`, `truncateStr`, `truncateJSON`)
  before they are logged. A scout that dumps a 5 MB log must not bloat the
  database or the SSE stream.
- **Timeouts are layered**: 45s per toolbox call, `Orchestrator.Timeout`
  (default 4m) per run. A hung `gh` or `gcloud` cannot wedge a run.
- `emit` holds the mutex only to snapshot the subscriber set; sends happen
  outside it, so a slow SSE reader cannot stall the orchestrator.
- Agent names are a closed set used as event keys and in the UI:
  `orchestrator | repo | github | linear | datadog | gcloud | synthesis`.

## Gotchas

- `golangci-lint` excludes `G204` (subprocess with variable args) and `G306`
  (file perms) here. That is deliberate for the shim and the `claude`/`gh`/
  `gcloud` execs — it is not permission to widen what gets executed.
- `claudeStream` parses newline-delimited JSON; a malformed line is skipped,
  not fatal. Claude Code's stream format is not versioned — if events stop
  rendering, diff the raw stream first.
- The shim is `sh`-only, so deep enrichment is POSIX-only today. Windows
  builds compile but the shim will not run.

## Maintenance

New source → `Availability` + `Probe` + a prompt in `scouts.go` +
`enabledScouts` + verbs in `Call` + the toggle in `EnrichSettings` and the
Settings page. New tool verb → `Call` **and** the prompt that advertises it,
or the agent will never invoke it.
