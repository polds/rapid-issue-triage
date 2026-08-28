# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-08-27

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

## Do-Not-Repeat

- [2026-08-27] Do not gate MCP key fields on `src.enabled`. Datadog then showed "set keys in Settings" with no inputs. Always render secret rows for sources that declare them.
- [2026-08-27] Never commit `.wolf/dashboard-token`. It is the OpenWolf dashboard auth secret (64-hex, mode 0600). Roll by deleting the file; the next `openwolf dashboard` / daemon start mints a new one. Gitignore it.
- [2026-08-27] Go 1.27 rejects `QueueFilter{}.Empty()` (struct-literal field selector). Write `(QueueFilter{}).Empty()`.

## Decision Log

- [2026-08-27] Persist Settings secrets in sqlite rather than writing `.env`, so the UI is the source of truth and we don't rewrite dotenv files the user may edit by hand.
- [2026-08-27] golangci-lint is `default: all` with a curated disable list. **gocyclo min-complexity is 15** (tests excluded). Split functions rather than raising the cap.
- [2026-08-27] HTTP server sets `ReadHeaderTimeout`; sqlite parent dir is `0700`. Coverage floor is 70% on `internal/config` + `internal/store` only.
