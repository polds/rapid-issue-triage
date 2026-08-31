# internal/ — Go packages

Nine packages. Each of the seven substantial ones has its own CLAUDE.md; the
two leaves below the table are a file apiece and are documented here. The whole
backend is here; `cmd/triage` only wires it together and `webui.go` only embeds
the frontend.

| Package | Owns | Read before touching |
|---|---|---|
| [`store/`](store/CLAUDE.md) | sqlite: schema, issue index, queue order, macros, activity log, enrichment cache, secrets. **The only SQL in the repo.** | any persistence or wire-model change |
| [`server/`](server/CLAUDE.md) | HTTP API + embedded SPA, the route table, and the single Linear write path (`resolveOps`/`applyOps`). | any endpoint or triage-action change |
| [`syncer/`](syncer/CLAUDE.md) | Background Linear → sqlite indexing, generation-based pruning, staleness reporting. | anything about what the queue contains |
| [`linear/`](linear/CLAUDE.md) | Hand-written GraphQL client. Shared pointer; `SetAPIKey` retargets every holder at once. | new queries/mutations, issue field changes |
| [`deep/`](deep/CLAUDE.md) | Multi-agent deep enrichment: scout fanout, the credential-free tool shim, streamed events, synthesized report. | new data sources or tools |
| [`ai/`](ai/CLAUDE.md) | Fast enrichment: one `claude -p` call → summary + verdict. | prompt or verdict changes |
| [`config/`](config/CLAUDE.md) | YAML config, defaults, and the env/`.env` credential lookup. Imports nothing internal. | new settings or credentials |
| `version/` | The build stamp (`Resolve`) and release ordering (`Parse`/`Compare`/`IsNewer`). Stdlib only. GoReleaser stamps `main.version`; an unstamped build falls back to Go's embedded VCS info, and a synthesized pseudo-version is treated as `dev` rather than as a release. | the `-version` output, or what counts as "newer" |
| `update/` | The daily "is there a newer release?" check: one unauthenticated GET to GitHub's public releases endpoint, its result cached in memory for `GET /api/version`. **The only outbound call that is not Linear or the local `claude` binary**, and `update_check.enabled: false` switches it off. | anything about that request or what the UI shows for it |

## Dependency direction

```
cmd/triage ──> server ──> store, linear, syncer, ai, deep, update
                 │
              syncer ──> linear, store
                deep ──> linear, store, config
                  ai ──> store
              update ──> version
              config ──> (stdlib + yaml only)
             version ──> (stdlib only)
```

`config`, `store` and `version` are leaves and must stay that way — everything
imports them. `update` holds no credentials and reads no local state; keep it
that way, so the one outbound call it makes stays trivially auditable. There are no interfaces between packages: concrete types are passed
directly, and tests use real sqlite in a `t.TempDir()`.

## Conventions that hold across all of them

- **Package comments explain the *why*.** Every package has one on its
  primary file; keep it accurate, it is the first thing an agent reads.
- **No `os.Getenv` for credentials.** Use `config.Lookup` (env → `.env`) or
  `store.Resolve` (Settings → env → `.env`).
- **No SQL outside `internal/store`.**
- **Timestamps are RFC3339 UTC strings** end to end — sqlite, JSON, and the
  frontend all agree on that.
- **`gocyclo` caps functions at complexity 15** (`.golangci.yml`). Split the
  function; do not raise the cap.
- **`golangci-lint` runs `default: all`** with a curated disable list. Path-
  scoped `gosec` exclusions exist per package and are documented in each
  package's CLAUDE.md — treat them as narrow, not as precedent.
- **Go struct JSON tags are the frontend's contract.** Nothing validates them
  against `web/src/lib/types.ts`; changing one means changing both.

Local gate: `make ci-go` (fmt, `go fix`, vet, golangci-lint, `test -race`,
coverage floor on `config` + `store`).
