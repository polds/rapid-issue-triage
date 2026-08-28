# cmd/triage — the binary: wiring, flags, and the scout shim

`main.go` only. Two responsibilities, and no business logic in either.

## 1. `triage tool <tool> [args...]` — the shim client

**Checked before `flag.Parse`, as `os.Args[1]`.** Deep-enrichment scouts get a
`triage-tool` script on their `PATH` that re-execs this binary in this mode.
It reads `RT_TOOLBOX_URL` / `RT_RUN_TOKEN` / `RT_AGENT` from the environment,
POSTs the call to the running server's `/api/toolbox`, prints the JSON reply,
and exits. It holds no credentials and reaches nothing directly — that is the
whole point. See [`internal/deep/CLAUDE.md`](../../internal/deep/CLAUDE.md).

Adding a normal flag named `tool` would collide with this. Don't.

## 2. `run()` — startup order

```
config.Load(-config)          → -addr override
store.Open(cfg.DBPath)        → schema + additive migrations
cfg.APIKey()                  → falls back to the Settings-stored key
linear.New(key)               → ONE client, shared by server/syncer/toolbox
syncer.New(...)
if cfg.AI.Enabled:
    ai.Enricher + deep.NewOrchestrator   (built even if `claude` is missing)
server.New(...) + webui.Dist()
go syncer.Run(ctx); go srv.PrefetchEnrichments(ctx, cfg.AI.Prefetch)
http.Server{ReadHeaderTimeout: 10s}  → openBrowser unless -no-open
signal.NotifyContext(SIGINT, SIGTERM) → 5s graceful Shutdown
```

## Invariants

- **The AI stack is constructed whenever `ai.enabled` is true, even if the
  `claude` binary is absent** — only a log line notes it. Settings can then
  supply a path and enrichment starts working without a restart. A startup
  `LookPath` guard that skipped construction would break that; it was removed
  deliberately.
- **One `*linear.Client` for the whole process.** Server, syncer, and toolbox
  share the pointer so a key saved in Settings retargets all three at once.
- **A missing `LINEAR_API_KEY` is not fatal if Settings has one.** The
  fallback order at startup is env/`.env` → sqlite secrets. (Open question in
  `.wolf/STATUS.md`: whether to boot with no key at all and force a setup
  screen. Today, a key is still required at process start.)
- **`version`/`commit`/`date` are `-ldflags`-injected by GoReleaser** and
  default to `dev`. Never set them in code.
- Flags are the complete CLI: `-config`, `-addr`, `-no-open`, `-version`.
  There are no subcommands other than the hidden `tool`.

## Gotchas

- `gosec` `G204`/`G107` are excluded on this path — `openBrowser` execs a
  platform opener and the shim POSTs to a variable URL. Both are intentional
  and narrow.
- `openBrowser` failures are ignored on purpose; a headless machine should
  still serve the UI.

## Maintenance

New wiring belongs here; new *behaviour* belongs in an `internal/` package.
If `run()` needs a fifth constructor argument, that is the signal to group
them into a struct rather than to keep appending.
