# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-08-28 (dependabot commit scopes)

## User Preferences

- Wants Claude-missing warnings on both the issue card and Settings, plus an Advanced override for the `claude` binary path.
- Wants MCP API keys (Linear, GitHub, Datadog) settable in the Settings UI rather than env-only.
- Wants golangci-lint near-pedantic, with **gocyclo min-complexity 15** as a hard cap so agents cannot dump kitchen-sink functions. Style-war rules (lll, noctx, fieldalignment, forbidigo, revive exported comments) stay disabled so CI remains green.

## Key Learnings

- **Project:** rapid-issue-triage
- Claude is probed at runtime with `exec.LookPath`. `EnrichSettings.ClaudePath` overrides config `ai.command`. Enricher/orchestrator are constructed even when the binary is missing so a later path save can enable enrichment without restart.
- Credentials set in Settings are sqlite `meta.secrets` JSON. Resolution order: Settings → env → `.env` / `~/.rapid-triage/.env` (`config.Lookup`). The API never returns secret values, only `{set, source, hint}`.
- The browser cannot give a real filesystem path (`showDirectoryPicker` / `<input webkitdirectory>`). Native pick is `POST /api/pick` → osascript (macOS) / zenity|kdialog (Linux) / PowerShell (Windows).
- Linear's live client is a shared pointer; `Client.SetAPIKey` updates server, syncer, and toolbox together.
- `goreleaser release --snapshot` **never publishes** — it is a build/package dry run. Only `goreleaser release` (no `--snapshot`) creates the GitHub Release, and it needs a real tag (from the checked-out ref or `GORELEASER_CURRENT_TAG`). A workflow that branches on `github.ref_type == 'tag'` therefore does nothing publishable on a `workflow_dispatch` from a branch.
- This repo has GitHub **immutable releases** enabled. A published release's assets and tag are frozen forever and the tag name can never be reused, even after deleting the release. GoReleaser is compatible as-is because it uploads into a draft and un-drafts at the end — the flow immutability requires.
- A Claude Code remote session **cannot push tags**: `git-receive-pack` returns HTTP 403 for `refs/tags/*` while branch pushes to `claude/*` succeed. The GitHub MCP toolset has no create-tag/create-ref call either. Cutting a release from a session means a `workflow_dispatch` that mints the tag inside the job.
- `goreleaser check` validates `.goreleaser.yaml` offline (`go install github.com/goreleaser/goreleaser/v2@latest`). Use it before claiming a config key exists.
- `actionlint` is the fast local gate for workflow edits: `go install github.com/rhysd/actionlint/cmd/actionlint@latest`, then run it from the repo root with no args to lint every workflow.

- CI and local must run the same commands. The `go` job in ci.yml calls `make fmt-check / fix-check / vet / test-race / cover-go / vuln` rather than spelling out `go ...` twice, so `make ci` and CI cannot drift.
- `go run <tool>@<ver>` picks its toolchain from the TOOL's go.mod, not this module's. For a go1.27 module, pin `GOTOOLCHAIN=go$(go list -m -f '{{.GoVersion}}')` or the tool is built with an older Go and cannot parse the source at all.
- `./...` does not skip `node_modules`. web/node_modules ships a Go file (eslint -> flat-cache -> flatted), so Makefile targets filter it out and .golangci.yml excludes the path.
- eslint-plugin-react-hooks v7: the flat config is `configs.flat.recommended`. `configs["recommended-latest"]` is still the eslintrc shape and ESLint 10 rejects it ("plugins" as an array of strings).
- v7 also ships the React Compiler rules (immutability, purity, set-state-in-effect, preserve-manual-memoization, static-components). They were all deferred when the lint gate landed; they are being re-enabled one rule per PR. `static-components` is enabled as of PR #23 (zero violations - verify a rule is actually loaded with `npx eslint --print-config <file>` before trusting a clean run).
- zizmor's cache-poisoning audit flags `actions/setup-node` in any tag-triggered workflow no matter what `cache:` says. It cannot be silenced inline; use `.github/zizmor.yml` `rules.<audit>.ignore`.
- Frontend coverage floor is scoped in vitest.config.ts to the pure src/lib modules, matching how GO_COVER_PKGS scopes the Go floor. Whole-tree floors would just be diluted by React components.

### Git merge drivers (2026-08-28)
- `.wolf/memory.md` carries `merge=union` in `.gitattributes`. It is append-only, so
  parallel branches collide on the same tail with no real decision to make.
- Union applies **only to hunks that actually conflict**. A change one side makes
  alone - the 7-day memory-compression cron deleting old rows - is still resolved by
  the normal 3-way merge, so union does not resurrect compressed entries. Verified
  empirically, not assumed.
- Union has no ordering: it emits ours-then-theirs, so session blocks can land out of
  chronological order. Accepted; the alternative was a custom driver.
- A custom driver named in `.gitattributes` but not configured in a given clone
  degrades to a normal text conflict - it never silently resolves the wrong way. That
  makes custom drivers safe to ship, but they need per-clone `git config`, which is
  why this repo took the built-in.
- Never widen union to the `.wolf` JSON state files (invalid JSON) or to
  `cerebrum.md` / `STATUS.md` (edited in place, so it duplicates sections).

## Do-Not-Repeat

- [2026-08-27] Do not gate MCP key fields on `src.enabled`. Datadog then showed "set keys in Settings" with no inputs. Always render secret rows for sources that declare them.
- [2026-08-27] Never commit `.wolf/dashboard-token`. It is the OpenWolf dashboard auth secret (64-hex, mode 0600). Roll by deleting the file; the next `openwolf dashboard` / daemon start mints a new one. Gitignore it.
- [2026-08-27] Go 1.27 rejects `QueueFilter{}.Empty()` (struct-literal field selector). Write `(QueueFilter{}).Empty()`.
- [2026-08-28] Do not assume a merged release-config fix applies to an existing tag. Publishing tag X checks out X's tree, and GoReleaser reads `.goreleaser.yaml` from there - only the workflow YAML comes from the dispatched ref. A tag cut before the fix stays broken forever; re-tag it or move to a new version. This is why v0.1.0 was abandoned for v0.1.1.
- [2026-08-28] Do not put `dist/*.spdx.json` in `release.extra_files`. SBOMs are already first-class GoReleaser artifacts that it uploads itself; the glob double-queues all 42 and the release dies on `422 already_exists`. `checksum.extra_files` is the one that should keep them (checksums.txt subjects only, no upload).
- [2026-08-28] A green `--snapshot` run proves nothing about uploading. Snapshot never touches the Releases API, so upload-path bugs (duplicate asset names, immutability, auth) survive any number of green dry runs and detonate on the first real tag.
- [2026-08-28] Never create the GitHub Release by hand in the Releases UI while immutable releases are on. It publishes instantly, GoReleaser then cannot attach any archive/SBOM/checksum, the run fails on preflight, and the tag name is burnt permanently — the version must be bumped. Let the workflow create the release.
- [2026-08-28] Do not treat a green Release run as a published release. Run 33144134442 succeeded, built every archive/SBOM, and created nothing, because a `workflow_dispatch` from `main` took the `--snapshot` branch. Check the run's resolved GoReleaser version (`8aa5c68-snapshot`, `tag: v0.0.0`) and whether the attestation step was skipped.

- [2026-08-28] Do not add an ESLint gate that requires refactoring the whole app. The first type-checked run produced 127 errors; the noisy families (`no-unsafe-*` from `res.json()` being `any`, `no-floating-promises`, the React Compiler rules) are turned off with a written reason in eslint.config.js so the debt is visible in review, and everything else gates as an error. A lint job that cannot pass is not a CI improvement.
- [2026-08-28] Do not assume a tool failing locally means CI is broken. `make lint` and `make vuln` both failed here on the go1.26/go1.27 toolchain mismatch while every CI run on main was green - CI uses a prebuilt golangci-lint binary and a setup-go environment. Check the actual run conclusions before reporting a red pipeline.

- [2026-08-28] Do not trust a green local `actionlint`. It shells out to shellcheck for `run:` blocks only when shellcheck is on PATH, and silently skips them otherwise while still exiting 0. GitHub runners have it; dev containers often do not. `make actions-lint` now warns locally and hard-fails in CI when it is missing.
- [2026-08-28] Do not run zizmor without `--no-online-audits` unless a GitHub token is present. Unauthenticated it does not degrade, it panics with a 401 and performs no audit at all.
- [2026-08-28] A pre-commit hook must not just call `make ci`. Scope each gate to the staged paths (Go / web / workflows), or a one-line web tweak pays for the Go race suite and people start using --no-verify.

- [2026-08-28] Do not rename a CI job without checking the `Main` ruleset's required status checks. Renaming `web.name` from "Web typecheck and build" to "Web lint, test, build" left the required check waiting for a name nothing reports any more, so PR #16 sat `blocked` with all 14 checks green. Required checks match by exact string, and adding a matrix renames a job too (`Job name (leg)`). Read the ruleset with `curl /repos/OWNER/REPO/rulesets/<id>` before touching a job name.

- [2026-08-28] Never add the `creation` rule to the `Release Tags` tag ruleset (21759998) without first adding a bypass actor. `release.yml`'s `create_tag` path pushes `refs/tags/$RELEASE_TAG` with `GITHUB_TOKEN`, which holds no bypass permission, so restricting creations makes every tag push 403 and the release path dies. Enabling it requires a GitHub App token (`actions/create-github-app-token`) or a deploy key registered as a bypass actor. Same reason `required_signatures` stays off: the runner's `git tag -a` is unsigned.

- [2026-08-28] Do not put `tag_name_pattern` (or any metadata-restriction rule: `branch_name_pattern`, `commit_message_pattern`, `commit_author_email_pattern`) in a ruleset for this repo. It is a user-owned repo, and those rules 422 with `Invalid rule 'tag_name_pattern':`. The structural rules (`creation`, `update`, `deletion`, `non_fast_forward`) do work here - the "Release Tags" ruleset uses three of them. Semver enforcement therefore lives only in release.yml's own regex guard, which is fine: the release trigger glob is `v*.*.*`, so a non-semver tag cannot fire a release.
- [2026-08-28] Do not combine a scoped Dependabot `commit-message.prefix` with `include: "scope"`. Dependabot appends its own `(deps)` / `(deps-dev)` scope to whatever prefix you give it, so `prefix: "build(backend)"` plus `include: scope` emits `build(backend)(deps): ...`, which is not a valid Conventional Commit. Pick one: either the area lives in the prefix's scope (what this repo does) or you let Dependabot own the scope with `deps`.

## Decision Log

- [2026-08-27] Persist Settings secrets in sqlite rather than writing `.env`, so the UI is the source of truth and we don't rewrite dotenv files the user may edit by hand.
- [2026-08-27] golangci-lint is `default: all` with a curated disable list. **gocyclo min-complexity is 15** (tests excluded). Split functions rather than raising the cap.
- [2026-08-27] HTTP server sets `ReadHeaderTimeout`; sqlite parent dir is `0700`. Coverage floor is 70% on `internal/config` + `internal/store` only.
- [2026-08-28] **Reversed:** manual Release runs may now mint the tag, via a `create_tag` checkbox. The original objection — a `GITHUB_TOKEN` tag push does not re-trigger the tag-push workflow — only applies when the release depends on a *second* trigger. The same job continuing into GoReleaser needs no re-trigger, and the missing re-trigger is what prevents a double release. Superseded: the entry below.
- [2026-08-28] ~~Manual Release runs publish only when given an explicit existing `v*.*.*` tag input, never by minting a tag in CI.~~ A tag pushed with `GITHUB_TOKEN` would not retrigger the tag-push workflow, so tagging stays a human `git push` step; the no-input dispatch remains a snapshot dry run and uploads `snapshot-dist` for inspection.

- [2026-08-28] CI/CD hardening. Adopted actionlint + zizmor over the workflows, ESLint + Vitest for the frontend, CodeQL (Go + TS, security-extended), OpenSSF Scorecard, and dependency-review. Rejected StepSecurity harden-runner: adding a broad third-party action that proxies all runner egress is itself supply-chain surface, and the repo already pins every action to a SHA.
- [2026-08-28] Release job runs with caching disabled on setup-go and setup-node. A cache entry poisoned from any branch would otherwise be reachable from signed, attested artifacts. Releases are rare; a cold build is the right trade.
- [2026-08-28] Release checkout uses persist-credentials: false; the tag push authenticates with an explicit x-access-token URL instead, so the job token never sits in .git/config while GoReleaser runs.
- [2026-08-28] Optional-tool gates use the `CI` env var as the switch: skip with a warning on a developer machine, hard-fail on a runner. A CI check that silently no-ops when its binary is absent is worse than no check.
- [2026-08-28] Tag ruleset "Release Tags" (id 21759998, active, ~ALL tags, no bypass actors): deletion + non_fast_forward + update. Tags are Go module versions - once anyone resolves one, sum.golang.org pins its hash forever, so moving or deleting a tag does not un-publish it, it just breaks consumers with a checksum mismatch while the proxy keeps serving the original. `update` is accepted on a tag target (confirmed empirically). `creation` and `required_signatures` are deliberately absent - both would 403 the release workflow.
- [2026-08-28] Branch ruleset "Main" now requires all 11 CI contexts, not 3. Adding a job to ci.yml without adding its name here leaves the gate unenforced; renaming one leaves a required check that can never report.

- [2026-08-28] Dependabot writes Conventional Commits whose **scope is the repo area, not `deps`**: `build(backend)` for gomod, `build(frontend)` / `chore(frontend)` (devDependencies) for npm in `/web`, `ci(actions)` for github-actions. `build` is the Conventional Commits type for dependency/build-system changes; `ci` for the workflow toolchain. Chose the area over `deps` because the repo is a Go backend plus a `/web` frontend in one tree and the ecosystem alone does not say which half a PR touches. Nothing enforces this in CI - metadata rulesets (`commit_message_pattern`) 422 on this user-owned repo - so the config is the only place it is specified.
