# STATUS — rapid-issue-triage

> Single source of truth for resuming work. Read this FIRST when starting a session.
> Update this file at the end of every work phase so the next `/clear` resumes in 1 read.
> Last updated: 2026-08-28 (lint fan-out merged; next: keep the committed web/dist honest)

---

## ✅ Done

- Claude probe is live (`LookPath` on each settings/meta/enrich request). Missing CLI shows a warning on the issue card and Settings. Advanced → Claude binary path (text + native file picker) stored as `enrich_settings.claudePath`.
- MCP API keys (Linear, GitHub token, Datadog API+app) can be set on Settings. Stored in sqlite `meta.secrets`. Never returned in full; UI shows last-4 hint. Settings override env/.env.
- Repository "Browse" opens a native OS folder picker (`POST /api/pick`). Claude path Browse uses the file picker.
- GitHub Actions CI (fmt, go fix, vet, golangci-lint v2.13, tests, 70% coverage on config/store, web build, binary compile, govulncheck, npm audit, gitleaks), Dependabot, and tagged GoReleaser releases (multi-OS, SPDX SBOM, SLSA provenance, reproducible builds).
- Go 1.27 + `go fix` modernizers. golangci-lint is pedantic (`default: all`) with **gocyclo min-complexity 15**.
- CI/CD hardening (PR #16, merged): ESLint 10 + Vitest for the frontend (33 tests, 90% floor scoped to the pure `src/lib` modules), `actionlint` + `zizmor` over the workflows, CodeQL (Go + TS, security-extended), OpenSSF Scorecard, dependency review, `SECURITY.md`. `persist-credentials: false` everywhere, per-job timeouts, `go test -race`, 3-OS binary compile, pinned govulncheck. Release job runs cache-free so a poisoned cache cannot reach attested artifacts.
- Release workflow publishes. `workflow_dispatch` takes an optional `tag` input: empty = snapshot dry run (uploads `snapshot-dist`), a `v*.*.*` tag = real `goreleaser release --clean` + provenance attestation. Diagnosed from run 33144134442, which was snapshot-only.

- Every deferred ESLint rule is enforced (PRs #23-#30, #32, #33, merged; main `cb8b536`). One PR per rule: `react-refresh/only-export-components`, `react-hooks/{static-components,set-state-in-effect,purity,immutability,preserve-manual-memoization}`, `@typescript-eslint/{no-floating-promises,no-explicit-any,no-unsafe-*}`. `eslint.config.js` has no deferred block left. `npm run lint` = 0 errors / 2 warnings (`exhaustive-deps` in store.tsx), 33/33 tests, 100% coverage on the scoped modules.
- Fast-refresh extractions from that work: `web/src/lib/triage-context.ts`, `web/src/components/ui/use-toast.ts`, `web/src/components/triage/report-format.ts`. Two real bugs fixed on the way: Confetti re-randomized every particle on each re-render mid-burst, and `no-explicit-any` unmasked 5 `no-base-to-string` errors.

---

## 🚀 Next phase

**Goal:** Stop `web/dist` from drifting. It is tracked on purpose - `webui.go` embeds it with `go:embed`, so `go install github.com/polds/rapid-issue-triage/cmd/triage@latest` fails to compile without it - but nothing verifies it matches `web/src`. It was last rebuilt in `d7f6ae7`, before eight lint PRs and several dependency bumps, so a plain checkout of main today embeds a UI that predates every one of those fixes.

### Acceptance criteria
1. CI fails when the committed `web/dist` does not match a fresh `npm ci && npm run build` from the same tree.
2. The check is reproducible - a clean checkout rebuilt twice must produce byte-identical output, or the check is flaky and worthless.
3. `web/dist` on main is rebuilt from current source so the gate starts green.
4. The new job's exact name is added to the "Main" ruleset's required status checks, or the gate is advisory only (see cerebrum: required checks match by exact string).

### Closed decisions
- `web/dist` stays tracked. Untracking it would break `go install` of the module, which is the point of embedding.
- Verify-only, not a bot that rebuilds and commits: a workflow that pushes generated output to `main` needs write access on every PR and turns an unreviewed build into a commit. A red check tells the author to run `make web-build` themselves.
- Repo rulesets: "Main" (branch) requires all 11 CI contexts; "Release Tags" (tag, ~ALL) blocks deletion, tag moves, and force pushes. Neither has bypass actors. Adding `creation` to the tag ruleset would break `release.yml` - see cerebrum.
- Secrets live in sqlite, not rewritten `.env` files.
- Enricher + orchestrator are created whenever `ai.enabled` is true, even if `claude` is missing, so a later Settings path can enable enrichment without a restart.
- Native picker is a Go subprocess (osascript / zenity / PowerShell) because the browser cannot expose filesystem paths.
- Coverage floor applies to `internal/config` + `internal/store` (70%), not the whole module.

### Open decisions
- Whether first-run should boot without `LINEAR_API_KEY` and force a Settings setup screen (still required at process start today).
- Dependabot majors are open and not safe to merge blind: #9 bumps TypeScript to 7.0.2, outside `typescript-eslint@8`'s peer range (`<6.1.0`), which would break the whole type-aware config. #7 (vite 8) and #8 are also majors.

---

## 📁 Active architecture

- **Stack:** Go 1.27 HTTP API + sqlite (`~/.rapid-triage/triage.db`) + embedded Vite/React UI
- **Key tables / modules:** `meta` (enrich_settings, secrets), `internal/server/settings.go`, `internal/server/pickfolder.go`, `internal/store/secrets.go`
- **Patterns:** Toolbox never holds raw keys in JSON responses; Probe/Call resolve Settings then env/.env

---

## ⚠️ External blockers (don't block coding)

- The existing `triage` process on `127.0.0.1:7333` is still the pre-change binary. Restart it (or `make build && ./triage`) to use these features. A verify instance was run on `:7334`.
- Release `v0.1.1` was cut from run 33166540050. `v0.1.0` was abandoned - its tag predates the SBOM fix, and publishing a tag uses that tag's tree. Never hand-create a release in the UI; immutability burns the tag name.

---

## 🔧 Useful commands

```bash
make build
make ci                 # ci-go + web-ci + actions-lint (everything CI gates on)
make ci-go              # fmt, go fix, vet, lint, test -race, coverage
make web-ci             # eslint, vitest + coverage floor, vite build
make actions-lint       # actionlint + zizmor (zizmor optional locally)
make vuln               # pinned govulncheck
make hooks              # install .githooks/pre-commit (path-scoped)
go run ./cmd/triage -no-open
cd web && npm run dev   # UI :5173, proxies /api → :7333
```

---

## 📚 References (read IF needed)

- `.wolf/cerebrum.md` — User Preferences + Do-Not-Repeat + Decision Log
- `.wolf/anatomy.md` — token-efficient file index
- `.wolf/buglog.json` — known bugs + fixes
