# STATUS — rapid-issue-triage

> Single source of truth for resuming work. Read this FIRST when starting a session.
> Update this file at the end of every work phase so the next `/clear` resumes in 1 read.
> Last updated: 2026-08-28 (container image added to the release; lint fan-out merged and web/dist gated against a fresh build; directory-level CLAUDE.md tree + OpenWolf CLI bootstrap; repo hygiene PRs #31 + #35; first release cut as v0.1.1)

---

## ✅ Done

- **Container image in the release.** `dockers_v2` + `docker_digest` in
  `.goreleaser.yaml` publish `ghcr.io/polds/rapid-issue-triage` (linux/amd64 +
  linux/arm64) on the same run that cuts a GitHub Release, tagged
  `{{.Version}}` / `MAJOR.MINOR` / `latest` (the last two suppressed on a
  prerelease). The root `Dockerfile` only `COPY`s the binary GoReleaser already
  built onto a digest-pinned distroless `static-debian13:nonroot`, so the image
  ships the attested bytes; OCI labels come from `build_args` (version, commit,
  `.CommitDate`, source) and OCI annotations from `dockers_v2.annotations`
  (including `base.name` / `base.digest` read off the `FROM` line).
  `release.yml` gained `packages: write`, `docker/setup-buildx-action`
  (`cache-binary: false`), a GHCR login gated on a release tag, and a second
  `actions/attest` over `dist/digests.txt`. Snapshot dispatches build the image
  locally and push nothing. Dependabot now tracks the base image
  (`build(docker)`), held from auto-merge like the release-only actions.
- **OpenWolf CLI bootstrap.** `.claude/hooks/session-start.sh` (adopted from a sibling repo) reinstalls the `openwolf` CLI on every remote session start, registered first in `.claude/settings.json` SessionStart. The committed `.wolf/hooks/*.js` always worked; the CLI did not survive the ephemeral container, so `openwolf scan`/`find`/`designqc` were unavailable and anatomy.md drifted. `.claude/rules/openwolf.md` gained the designqc rule.
- **Agent docs tree.** Root `CLAUDE.md` is now an index (architecture map, non-negotiables, domain vocabulary, maintenance triggers) linking 16 directory-level `CLAUDE.md` files: `cmd/triage`, `internal/` + all 7 packages, `web/` + `src/lib` + `src/pages` + `src/components{,/triage,/ui}`, and `.github/`. Each carries a layout table, invariants, path-scoped lint exclusions, and a "change X -> update Y" block. The OpenWolf block in the root is fenced with `<!-- openwolf:begin/end -->` so `openwolf init` can't clobber the index. `anatomy.md` is now generated, not hand-edited: `.claude/hooks/session-start.sh` reinstalls the `openwolf` CLI each remote session, and `openwolf scan` reindexed the tree at 121 files.
- Claude probe is live (`LookPath` on each settings/meta/enrich request). Missing CLI shows a warning on the issue card and Settings. Advanced → Claude binary path (text + native file picker) stored as `enrich_settings.claudePath`.
- MCP API keys (Linear, GitHub token, Datadog API+app) can be set on Settings. Stored in sqlite `meta.secrets`. Never returned in full; UI shows last-4 hint. Settings override env/.env.
- Repository "Browse" opens a native OS folder picker (`POST /api/pick`). Claude path Browse uses the file picker.
- GitHub Actions CI (fmt, go fix, vet, golangci-lint v2.13, tests, 70% coverage on config/store, web build, binary compile, govulncheck, npm audit, gitleaks), Dependabot, and tagged GoReleaser releases (multi-OS, SPDX SBOM, SLSA provenance, reproducible builds).
- Go 1.27 + `go fix` modernizers. golangci-lint is pedantic (`default: all`) with **gocyclo min-complexity 15**.
- CI/CD hardening (PR #16, merged): ESLint 10 + Vitest for the frontend (33 tests, 90% floor scoped to the pure `src/lib` modules), `actionlint` + `zizmor` over the workflows, CodeQL (Go + TS, security-extended), OpenSSF Scorecard, dependency review, `SECURITY.md`. `persist-credentials: false` everywhere, per-job timeouts, `go test -race`, 3-OS binary compile, pinned govulncheck. Release job runs cache-free so a poisoned cache cannot reach attested artifacts.
- Repo hygiene (PRs #31, #35, both merged). Generated files no longer tracked: the OpenWolf daemon's `.honcho-sync-state.json`, `_scan-state.json`, `cron-state.json`, `daemon.log`, `token-ledger.json`, plus `web/tsconfig.tsbuildinfo`. All were rewritten on every run, so they churned every commit and conflicted on every merge. Untracked with `git rm --cached`, so local state survives.
- `.gitattributes` marks `.wolf/memory.md` and `.wolf/cerebrum.md` `merge=union` — they are append-only, so parallel branches collided on the same tail with no real decision to make. Deliberately **not** applied to `buglog.json` or the JSON state (union interleaves keys into invalid JSON that git reports as a *successful* merge) or to `STATUS.md` / `anatomy.md` (rewritten in place, so union duplicates sections). Two caveats worth remembering: GitHub does not apply merge drivers, so a conflicted PR still needs `main` merged locally and the merge commit pushed; and while a PR is conflicted it has no merge ref, so the `pull_request` workflows never run and required checks read as absent rather than failing. `web/dist/` stays tracked despite being the #3 churner — `//go:embed all:web/dist` needs it at compile time.
- Every deferred ESLint rule is enforced (PRs #23-#30, #32, #33, merged; main `cb8b536`). One PR per rule: `react-refresh/only-export-components`, `react-hooks/{static-components,set-state-in-effect,purity,immutability,preserve-manual-memoization}`, `@typescript-eslint/{no-floating-promises,no-explicit-any,no-unsafe-*}`. `eslint.config.js` has no deferred block left; `npm run lint` is 0 errors / 2 warnings (`exhaustive-deps` in store.tsx). Three fast-refresh extractions came out of it (`lib/triage-context.ts`, `ui/use-toast.ts`, `triage/report-format.ts`), plus two real bug fixes: Confetti re-randomized every particle on each re-render mid-burst, and `no-explicit-any` unmasked 5 `no-base-to-string` errors.
- The committed `web/dist` is gated against a fresh build (PR #39). It stays tracked - `//go:embed all:web/dist` needs it, so `go install .../cmd/triage@latest` does not compile without it - but nothing verified it still matched `web/src`, and it had been stale since `d7f6ae7`: a plain checkout of main embedded a UI predating eight lint PRs. `make web-dist-check` rebuilds and fails on any difference; it runs inside `web-ci` (so the pre-commit hook covers it) and as a step in the existing `Web lint, test, build` job, so no new required context is needed. Verify-only by choice: a bot that rebuilds and commits would need write access on every PR.
- Release workflow publishes. `workflow_dispatch` takes an optional `tag` input: empty = snapshot dry run (uploads `snapshot-dist`), a `v*.*.*` tag = real `goreleaser release --clean` + provenance attestation. Diagnosed from run 33144134442, which was snapshot-only.

---

## 🚀 Next phase

**Goal:** Restart the long-running `:7333` process so the embedded UI/API pick up Settings work. First release is `v0.1.1` (run 33166540050). `v0.1.0` was abandoned: its tag predates the SBOM fix, and publishing a tag uses that tag's tree.

### Acceptance criteria
1. Production `triage` on `:7333` serves the new Settings (Browse, keys, Advanced Claude path).
2. Card view shows the Claude-missing banner when the binary is absent.
3. CI is green on `main`; the `v0.1.1` dispatch publishes GitHub Release archives with SBOM + provenance. Never hand-create the release in the UI - immutability burns the tag name. (Done 2026-08-28: the unused `v0.1.0` tag and its draft release were deleted, before the tag ruleset went active.)

### Closed decisions
- Repo rulesets: "Main" (branch) requires all 11 CI contexts; "Release Tags" (tag, ~ALL) blocks deletion, tag moves, and force pushes. Neither has bypass actors. Adding `creation` to the tag ruleset would break `release.yml` - see cerebrum.
- Secrets live in sqlite, not rewritten `.env` files.
- Enricher + orchestrator are created whenever `ai.enabled` is true, even if `claude` is missing, so a later Settings path can enable enrichment without a restart.
- Native picker is a Go subprocess (osascript / zenity / PowerShell) because the browser cannot expose filesystem paths.
- Coverage floor applies to `internal/config` + `internal/store` (70%), not the whole module.

### Open decisions
- Dependabot majors are open and not safe to merge blind: #9 bumps TypeScript to 7.0.2, outside `typescript-eslint@8`'s peer range (`<6.1.0`), which would break the whole type-aware config. #7 (vite 8) and #8 are also majors.
- Whether first-run should boot without `LINEAR_API_KEY` and force a Settings setup screen (still required at process start today).
- The container path is unrehearsed end to end: no local Docker daemon was available, so it was validated with `goreleaser check`, GoReleaser v2.18's own source (context layout, template fields, base-image parsing), and actionlint/shellcheck/zizmor — not an actual image build. **Run a snapshot dispatch (empty `tag`) before the next real tag**; it builds the image locally and pushes nothing.
- Whether to make the GHCR package public. It is created private on first push; the `org.opencontainers.image.source` label links it to the repo, and the setting is a one-time manual toggle.

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
