# STATUS — rapid-issue-triage

> Single source of truth for resuming work. Read this FIRST when starting a session.
> Update this file at the end of every work phase so the next `/clear` resumes in 1 read.
> Last updated: 2026-08-31 (deep enrichment runs are pooled — 2 at a time, the rest queue with a visible place in line — and a single notification can be dismissed on hover; previously: a card the background sync pruned no longer fails Skip/Snooze with "not found"; previously: Linear label-group conflicts detected before the mutation and resolved by a replace prompt; previously 2026-08-28: starter-workflow survey → OSV-Scanner + Trivy adopted into the Security job; CI scanning tier: SAST, license scan, code quality, plus a ReDoS fix in Markdown.tsx; container image added to the release; lint fan-out merged and web/dist gated against a fresh build; directory-level CLAUDE.md tree + OpenWolf CLI bootstrap; repo hygiene PRs #31 + #35; first release cut as v0.1.1)

---

## ✅ Done

- **Deep enrichment runs are pooled, and a single notification can be
  dismissed.** Two feature requests that share the notification surface.
  - **Pool.** `Orchestrator.Start` enqueues instead of launching; `drain`
    starts up to `MaxConcurrent` (default 2, `ai.max_concurrent`, clamped when
    a config sets 0) and re-announces the place in line of everyone still
    waiting. New run status `queued` ahead of `running` — `StartEnrichRun` is
    the transition, `FailOrphanRuns` treats a queued run as orphaned too, and
    the SSE poll asks `runUnfinished` rather than `status != "running"`.
    `POST …/enrich/deep` answers a `Placement` (`{runId, status, position}`).
  - **Waiting state in the UI.** The card renders `QueuedRun` ("#N in line")
    instead of an empty live feed; the bell shows `queued · #N` /
    "waiting for a free slot", keeps spinning, and refuses to clear a queued
    entry. `enrich` will not enqueue a second run for a card that already has
    one — a pooled run can wait minutes, which is exactly when a user presses
    `i` again.
  - **Dismissal.** Hovering a **finished** bell entry reveals an X that drops
    that one notice and its buffered events. Active runs get no X: the notice
    is the client's only record of a live run.
  - Pure notice logic lives in `web/src/lib/notices.ts` (14 tests, inside the
    90% coverage include); the pool has `internal/deep/pool_test.go`. Verified
    in the running app with the pool pinned to 1 — 3 runs → 1 running, 2 queued,
    positions advancing live — and a single dismissal leaving its neighbours.
  - The run skill's driver gained `hover <sel>` so hover-only UI is
    screenshot-able.

- **A pruned card no longer fails Skip/Snooze with "Action failed: not found".**
  The deck the browser holds is a snapshot, and the syncer's `PruneStale`
  deletes every issue that leaves the index filter, so a card can outlive its
  row. Skip and snooze then 404'd on `store.GetIssue`, the card rolled back, and
  the user was stranded on a card no keystroke could clear.
  - `store.ErrNotFound` is now an exported sentinel (same message,
    `errors.Is`-able); `errRow` returns it.
  - New `writeIssueErr` (`internal/server/server.go`) answers a pruned row with
    **404 `{code:"issue_gone"}`** plus an explanation, and anything that is not
    `ErrNotFound` with a **500** — the old code 404'd real database faults too.
    All six `GetIssue(r.PathValue("id"))` sites use it.
  - The UI adds a `"gone"` `CardStatus` and `retireGoneCard`: skip/snooze mark
    the card gone (dimmed, "LEFT THE INDEX" badge, actions disabled), advance
    the deck, and show a plain toast. Macros/quick edits deliberately keep the
    card pending — that Linear write did not happen.
  - Verified in the running app via the driver by `DELETE`ing the visible card's
    row from sqlite behind the deck's back; regression test in
    `internal/server/issuegone_test.go`.

- **Linear label-group clashes are now a prompt, not an error.** A macro adding
  a label from an exclusive group (`Area`) to an issue that already carried a
  sibling failed with Linear's own `labelIds not exclusive child labels`, after
  the card had swiped away.
  - `internal/linear` now requests `parent { id }` on `issueLabels`, the
    `labels` table has `parent_id` (additive migration), and
    `store.LabelGroupsFor` resolves group membership for a label set.
  - `resolveOps` ends in `resolveLabelGroups` (`internal/server/labelgroups.go`),
    which names the group and both sides. `writeActionErr` answers **409**
    `{code:"label_group_conflict", conflicts, resolvable}` instead of a 502;
    `opOptions.replaceGroupLabels` drops the pre-existing sibling once the user
    confirms. `exclusiveLabelHint` rewrites the raw wording for a group created
    since the last sync.
  - The UI pre-flights the same rule (`web/src/lib/labelgroups.ts`, mirroring
    `needsDuplicateOf`) and raises `LabelGroupPrompt` — Replace / Cancel — before
    the request, so there is no round trip and no swipe to undo. "Replace" is
    offered only when the action adds exactly one sibling.
  - Verified in the running app via the driver: the offline fixture now seeds an
    `Area` group (`ci-cd` on ENG-412, macro 4 adds `infrastructure`).

- **Starter-workflow survey → two adopted (OSV-Scanner, Trivy).** Walked
  GitHub's *Actions → New workflow → Security* catalogue (~76 entries) for
  anything worth adding beside CodeQL/semgrep/Scorecard.
  - **OSV-Scanner** (`make osv`, pinned v2.5.1) over `go.mod` *and*
    `web/package-lock.json`, SARIF to the Security tab. Not redundant with
    govulncheck: that one filters by reachability, which is the right gate for
    "fix it now" and the wrong one for an inventory of a binary users compile
    themselves. It is also the only route by which an npm finding reaches the
    Security tab at all — `npm audit` just prints.
  - **Trivy** (`make trivy`, pinned v0.74.0) over the base image read off the
    `Dockerfile`'s `FROM` line — the one part of the released container nothing
    scanned. No registry auth, works on a PR that published nothing, tracks the
    digest Dependabot bumps. Two passes on a warm DB: all findings into SARIF,
    then a HIGH/CRITICAL `--ignore-unfixed` gate. Base is currently 0 CVEs.
  - Both landed as **steps of the existing `Security` job**, not new jobs, so
    the `Main` ruleset needed no edit and both are enforced from the first run.
    Required checks stay at 14.
  - **Rejected, with reasons recorded in `.github/CLAUDE.md`:** Snyk, SonarQube
    /SonarCloud, Codacy, Checkmarx, Veracode, Fortify, Contrast, Black Duck,
    JFrog/Frogbot, Endor, Prisma, Sysdig, Zscaler, Mayhem, NowSecure,
    StackHawk, SOOS, Debricked, APIsec (all token-gated SaaS — same objection
    that already rules out `semgrep/semgrep-action`, and a fork PR never holds
    the secret); the `eslint.yml` starter (its only gain is a SARIF feed from a
    linter that already *blocks*, bought with a new redistributable dep);
    hadolint (nothing to match on a `COPY`-only distroless Dockerfile);
    Anchore/Grype (the release already emits an SPDX SBOM); Defender for
    DevOps and OSSAR (Azure/Windows); and everything targeting another
    language or absent infrastructure.

- **CI scanning tier (SAST, licenses, code quality).** Three new `ci.yml` jobs,
  each calling a `make` target so local and CI cannot drift.
  - **SAST** — pinned semgrep (`p/golang`, `p/gosec`, `p/typescript`, `p/react`,
    `p/secrets`) over Go *and* TSX with one engine, SARIF uploaded to the
    Security tab beside CodeQL's. Installed from PyPI, not the semgrep action,
    which wants a SaaS token. `make sast`.
  - **License scan** — `go-licenses` (allow-list, `--confidence_threshold=0.8`)
    plus a `npm query`-driven policy script: allow-list for the `.prod` tree
    that `web/dist` bundles and `go:embed` ships, copyleft deny-list for
    dev-only packages. `dependency-review` carries the same deny-list for what
    a PR adds. `make licenses`, `make licenses-report`.
  - **Code quality** — `go mod tidy -diff` + whole-program `deadcode`, the two
    gates neither golangci-lint nor eslint owns. `make quality`.
  - Frontend quality parity: `eslint-plugin-sonarjs` v4.2.0 at recommended with
    a curated disable list, mirroring `.golangci.yml`'s `default: all` shape.
  - Dependency vulnerability scanning (govulncheck, `npm audit`, dependency
    review) and secret scanning (gitleaks) were **already present** and were
    left alone; semgrep's `p/secrets` is a second pass over the latter.
- **ReDoS fixed in `web/src/components/Markdown.tsx`** — found by the new
  `sonarjs/super-linear-regex` rule on its first run. The link alternative's
  `[^)]+` target was unbounded, so `"[a](".repeat(n)` — ordinary issue-body
  text — rescanned to end-of-string from every `[`. 2529ms → 1ms at 160KB.
  Cost: a link target with a space or paren renders as text.

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

Carried forward from the pool work: **cancelling a queued run** is the obvious
next ask and was deliberately left out — it needs a server endpoint that pulls a
run out of `Orchestrator.queue` and finishes its row as `cancelled` (the status
already exists in `EnrichRun` on the TS side), plus an X on queued bell entries.

### Acceptance criteria
1. Production `triage` on `:7333` serves the new Settings (Browse, keys, Advanced Claude path).
2. Card view shows the Claude-missing banner when the binary is absent.
3. CI is green on `main`; the `v0.1.1` dispatch publishes GitHub Release archives with SBOM + provenance. Never hand-create the release in the UI - immutability burns the tag name. (Done 2026-08-28: the unused `v0.1.0` tag and its draft release were deleted, before the tag ruleset went active.)

### Closed decisions
- Deep runs are pooled server-side (not in `store.tsx`): the runs are server-owned goroutines that outlive the tab, and a browser-side limiter would be per-tab and would lie after a reload. Fast enrichment is deliberately not pooled.
- A queue position reaches the browser as an SSE event, never as a field the UI recomputes — one source of truth for the card and the bell.
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

- **The `Main` ruleset still requires 11 contexts, not 14.** `SAST`,
  `License scan` and `Code quality` run and report but cannot block a merge
  until they are added to the ruleset's required checks
  (`GET/PUT /repos/polds/rapid-issue-triage/rulesets/<id>`). Needs admin;
  the session that added the jobs had no ruleset API access.

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
