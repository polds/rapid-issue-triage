# internal/config — YAML config + credential lookup

Loads `rapid-triage.yaml` with local-first defaults, and owns the
environment/`.env` lookup chain the rest of the tree reads secrets through.
No dependencies on other `internal/` packages — everything imports this, so it
must import nothing back.

Carries the **70% coverage floor** together with `internal/store`
(`make cover-go`).

## Layout

Single file, `config.go`: `Config`/`SyncConfig`/`AIConfig`/`UpdateConfig`,
`Default`, `Load`, `APIKey`, `Lookup`, `ExpandHome`, `envFileValue`.

## Behaviour worth knowing

- **Search order for the config file** (first hit wins, all optional):
  `-config <path>` → `./rapid-triage.yaml` → `~/.config/rapid-triage/config.yaml`.
  No file at all is a valid, fully-defaulted run.
- **`Default()` is the source of truth for defaults**, not the YAML example.
  `rapid-triage.example.yaml` is documentation; keep it in step by hand.
- **`Filter` is `map[string]any` on purpose.** It is a raw Linear
  `IssueFilter` forwarded verbatim, so anything Linear supports works without
  a schema here. Never add validation or a typed struct — that would cap what
  users can express.
- **`Lookup(key)` is the credential chain: env → `./.env` →
  `~/.rapid-triage/.env`.** `store.Resolve` layers Settings on top of it, so
  the full precedence is **Settings → env → `.env`**. Anything that reads a
  credential should go through one of those two, never `os.Getenv`.
- **`.env` parsing is deliberately minimal** (`envFileValue`): `KEY=value`,
  `export` prefix and surrounding quotes stripped, `#` comments. It is not a
  dotenv implementation and should not grow into one.
- **`ExpandHome` handles `~` and `~/…` only** — not `~user`. Every
  user-supplied path (db, repo paths, claude binary) goes through it.
- `APIKey()` returning an error is not fatal at startup: `cmd/triage` falls
  back to the key stored in Settings.
- **`update_check` is the only kill switch for an outbound request.**
  `enabled: false` must actually stop `internal/update` from making one — that
  is the whole contract for an offline or air-gapped user, and it has a test.
  `interval` is floored at an hour by `update.New`, not here.

## Gotchas

- `G304` (file inclusion via variable) is excluded for this file — reading a
  user-named config path is the whole job. Do not extend the exclusion.
- Durations are `time.Duration` YAML strings (`10m`, `3m`). A bare number
  parses as nanoseconds and will silently look like a hang.

## Maintenance

New config key → the struct + `Default()` + `rapid-triage.example.yaml` + the
README's Configuration section. New credential → `Lookup` env names, plus
`store.Secrets`/`SecretStatus` if it should be settable in the UI.
