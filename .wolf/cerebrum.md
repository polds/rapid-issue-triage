# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-08-28 (immutable releases)

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

## Do-Not-Repeat

- [2026-08-27] Do not gate MCP key fields on `src.enabled`. Datadog then showed "set keys in Settings" with no inputs. Always render secret rows for sources that declare them.
- [2026-08-27] Never commit `.wolf/dashboard-token`. It is the OpenWolf dashboard auth secret (64-hex, mode 0600). Roll by deleting the file; the next `openwolf dashboard` / daemon start mints a new one. Gitignore it.
- [2026-08-27] Go 1.27 rejects `QueueFilter{}.Empty()` (struct-literal field selector). Write `(QueueFilter{}).Empty()`.
- [2026-08-28] Do not assume a merged release-config fix applies to an existing tag. Publishing tag X checks out X's tree, and GoReleaser reads `.goreleaser.yaml` from there - only the workflow YAML comes from the dispatched ref. A tag cut before the fix stays broken forever; re-tag it or move to a new version. This is why v0.1.0 was abandoned for v0.1.1.
- [2026-08-28] Do not put `dist/*.spdx.json` in `release.extra_files`. SBOMs are already first-class GoReleaser artifacts that it uploads itself; the glob double-queues all 42 and the release dies on `422 already_exists`. `checksum.extra_files` is the one that should keep them (checksums.txt subjects only, no upload).
- [2026-08-28] A green `--snapshot` run proves nothing about uploading. Snapshot never touches the Releases API, so upload-path bugs (duplicate asset names, immutability, auth) survive any number of green dry runs and detonate on the first real tag.
- [2026-08-28] Never create the GitHub Release by hand in the Releases UI while immutable releases are on. It publishes instantly, GoReleaser then cannot attach any archive/SBOM/checksum, the run fails on preflight, and the tag name is burnt permanently — the version must be bumped. Let the workflow create the release.
- [2026-08-28] Do not treat a green Release run as a published release. Run 33144134442 succeeded, built every archive/SBOM, and created nothing, because a `workflow_dispatch` from `main` took the `--snapshot` branch. Check the run's resolved GoReleaser version (`8aa5c68-snapshot`, `tag: v0.0.0`) and whether the attestation step was skipped.

## Decision Log

- [2026-08-27] Persist Settings secrets in sqlite rather than writing `.env`, so the UI is the source of truth and we don't rewrite dotenv files the user may edit by hand.
- [2026-08-27] golangci-lint is `default: all` with a curated disable list. **gocyclo min-complexity is 15** (tests excluded). Split functions rather than raising the cap.
- [2026-08-27] HTTP server sets `ReadHeaderTimeout`; sqlite parent dir is `0700`. Coverage floor is 70% on `internal/config` + `internal/store` only.
- [2026-08-28] **Reversed:** manual Release runs may now mint the tag, via a `create_tag` checkbox. The original objection — a `GITHUB_TOKEN` tag push does not re-trigger the tag-push workflow — only applies when the release depends on a *second* trigger. The same job continuing into GoReleaser needs no re-trigger, and the missing re-trigger is what prevents a double release. Superseded: the entry below.
- [2026-08-28] ~~Manual Release runs publish only when given an explicit existing `v*.*.*` tag input, never by minting a tag in CI.~~ A tag pushed with `GITHUB_TOKEN` would not retrigger the tag-push workflow, so tagging stays a human `git push` step; the no-input dispatch remains a snapshot dry run and uploads `snapshot-dist` for inspection.
