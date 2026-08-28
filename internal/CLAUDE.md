# internal/ — Go packages

Seven packages, each with its own CLAUDE.md. The whole backend is here;
`cmd/triage` only wires it together and `webui.go` only embeds the frontend.

| Package | Owns | Read before touching |
|---|---|---|
| [`store/`](store/CLAUDE.md) | sqlite: schema, issue index, queue order, macros, activity log, enrichment cache, secrets. **The only SQL in the repo.** | any persistence or wire-model change |
| [`server/`](server/CLAUDE.md) | HTTP API + embedded SPA, the route table, and the single Linear write path (`resolveOps`/`applyOps`). | any endpoint or triage-action change |
| [`syncer/`](syncer/CLAUDE.md) | Background Linear → sqlite indexing, generation-based pruning, staleness reporting. | anything about what the queue contains |
| [`linear/`](linear/CLAUDE.md) | Hand-written GraphQL client. Shared pointer; `SetAPIKey` retargets every holder at once. | new queries/mutations, issue field changes |
| [`deep/`](deep/CLAUDE.md) | Multi-agent deep enrichment: scout fanout, the credential-free tool shim, streamed events, synthesized report. | new data sources or tools |
| [`ai/`](ai/CLAUDE.md) | Fast enrichment: one `claude -p` call → summary + verdict. | prompt or verdict changes |
| [`config/`](config/CLAUDE.md) | YAML config, defaults, and the env/`.env` credential lookup. Imports nothing internal. | new settings or credentials |

## Dependency direction

```
cmd/triage ──> server ──> store, linear, syncer, ai, deep
                 │
              syncer ──> linear, store
                deep ──> linear, store, config
                  ai ──> store
              config ──> (stdlib + yaml only)
```

`config` and `store` are leaves and must stay that way — everything imports
them. There are no interfaces between packages: concrete types are passed
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
