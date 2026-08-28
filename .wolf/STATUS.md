# STATUS — rapid-issue-triage

> Single source of truth for resuming work. Read this FIRST when starting a session.
> Update this file at the end of every work phase so the next `/clear` resumes in 1 read.
> Last updated: 2026-08-28 (first release cut as v0.1.1)

---

## ✅ Done

- Claude probe is live (`LookPath` on each settings/meta/enrich request). Missing CLI shows a warning on the issue card and Settings. Advanced → Claude binary path (text + native file picker) stored as `enrich_settings.claudePath`.
- MCP API keys (Linear, GitHub token, Datadog API+app) can be set on Settings. Stored in sqlite `meta.secrets`. Never returned in full; UI shows last-4 hint. Settings override env/.env.
- Repository "Browse" opens a native OS folder picker (`POST /api/pick`). Claude path Browse uses the file picker.
- GitHub Actions CI (fmt, go fix, vet, golangci-lint v2.13, tests, 70% coverage on config/store, web build, binary compile, govulncheck, npm audit, gitleaks), Dependabot, and tagged GoReleaser releases (multi-OS, SPDX SBOM, SLSA provenance, reproducible builds).
- Go 1.27 + `go fix` modernizers. golangci-lint is pedantic (`default: all`) with **gocyclo min-complexity 15**.
- Release workflow publishes. `workflow_dispatch` takes an optional `tag` input: empty = snapshot dry run (uploads `snapshot-dist`), a `v*.*.*` tag = real `goreleaser release --clean` + provenance attestation. Diagnosed from run 33144134442, which was snapshot-only.

---

## 🚀 Next phase

**Goal:** Restart the long-running `:7333` process so the embedded UI/API pick up Settings work. First release is `v0.1.1` (run 33166540050). `v0.1.0` was abandoned: its tag predates the SBOM fix, and publishing a tag uses that tag's tree.

### Acceptance criteria
1. Production `triage` on `:7333` serves the new Settings (Browse, keys, Advanced Claude path).
2. Card view shows the Claude-missing banner when the binary is absent.
3. CI is green on `main`; the `v0.1.1` dispatch publishes GitHub Release archives with SBOM + provenance. Never hand-create the release in the UI - immutability burns the tag name. Optional cleanup from a laptop: unused `v0.1.0` tag at ff9f062 and unpublished draft release id 378431198.

### Closed decisions
- Secrets live in sqlite, not rewritten `.env` files.
- Enricher + orchestrator are created whenever `ai.enabled` is true, even if `claude` is missing, so a later Settings path can enable enrichment without a restart.
- Native picker is a Go subprocess (osascript / zenity / PowerShell) because the browser cannot expose filesystem paths.
- Coverage floor applies to `internal/config` + `internal/store` (70%), not the whole module.

### Open decisions
- Whether first-run should boot without `LINEAR_API_KEY` and force a Settings setup screen (still required at process start today).

---

## 📁 Active architecture

- **Stack:** Go 1.27 HTTP API + sqlite (`~/.rapid-triage/triage.db`) + embedded Vite/React UI
- **Key tables / modules:** `meta` (enrich_settings, secrets), `internal/server/settings.go`, `internal/server/pickfolder.go`, `internal/store/secrets.go`
- **Patterns:** Toolbox never holds raw keys in JSON responses; Probe/Call resolve Settings then env/.env

---

## ⚠️ External blockers (don't block coding)

- The existing `triage` process on `127.0.0.1:7333` is still the pre-change binary. Restart it (or `make build && ./triage`) to use these features. A verify instance was run on `:7334`.

---

## 🔧 Useful commands

```bash
make build
make ci                 # fmt, go fix, vet, lint, test, coverage
make hooks              # install .githooks/pre-commit
go run ./cmd/triage -no-open
cd web && npm run dev   # UI :5173, proxies /api → :7333
```

---

## 📚 References (read IF needed)

- `.wolf/cerebrum.md` — User Preferences + Do-Not-Repeat + Decision Log
- `.wolf/anatomy.md` — token-efficient file index
- `.wolf/buglog.json` — known bugs + fixes
