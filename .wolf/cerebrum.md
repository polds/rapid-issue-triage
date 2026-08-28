# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-08-27

## User Preferences

- Wants Claude-missing warnings on both the issue card and Settings, plus an Advanced override for the `claude` binary path.
- Wants MCP API keys (Linear, GitHub, Datadog) settable in the Settings UI rather than env-only.
- Folder picking should use the OS native dialog, not a text-only path field.

## Key Learnings

- **Project:** rapid-issue-triage
- Claude is probed at runtime with `exec.LookPath`. `EnrichSettings.ClaudePath` overrides config `ai.command`. Enricher/orchestrator are constructed even when the binary is missing so a later path save can enable enrichment without restart.
- Credentials set in Settings are sqlite `meta.secrets` JSON. Resolution order: Settings → env → `.env` / `~/.rapid-triage/.env` (`config.Lookup`). The API never returns secret values, only `{set, source, hint}`.
- The browser cannot give a real filesystem path (`showDirectoryPicker` / `<input webkitdirectory>`). Native pick is `POST /api/pick` → osascript (macOS) / zenity|kdialog (Linux) / PowerShell (Windows).
- Linear's live client is a shared pointer; `Client.SetAPIKey` updates server, syncer, and toolbox together.

## Do-Not-Repeat

- [2026-08-27] Do not gate MCP key fields on `src.enabled`. Datadog then showed "set keys in Settings" with no inputs. Always render secret rows for sources that declare them.

## Decision Log

- [2026-08-27] Persist Settings secrets in sqlite rather than writing `.env`, so the UI is the source of truth and we don't rewrite dotenv files the user may edit by hand.
- [2026-08-27] Keep constructing the enricher when `claude` is absent (if `ai.enabled`) instead of leaving it nil at startup. Path/settings changes apply immediately via `applyClaudeCommand`.
