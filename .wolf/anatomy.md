# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-08-26T22:30:31.429Z
> Files: 49 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.gitignore` — Git ignore rules (~8 tok)
- `AGENTS.md` — OpenWolf (~68 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `go.mod` — Go module definition (~151 tok)
- `go.sum` — Go dependency checksums (~1199 tok)
- `webui.go` — embeds the built frontend (web/dist) into the binary. (~84 tok)

## .claude/

- `settings.json` (~514 tok)

## .claude/commands/

- `reframe.md` — Mode: migrate [framework] (~551 tok)
- `security-audit.md` — Layer 1 — Dependencies (~510 tok)

## .claude/rules/

- `openwolf.md` (~328 tok)

## .codex/

- `config.toml` (~7 tok)
- `hooks.json` (~729 tok)

## .codex/prompts/

- `reframe.md` — Mode: migrate [framework] (~551 tok)
- `security-audit.md` — Layer 1 — Dependencies (~510 tok)

## .cursor/rules/

- `openwolf.mdc` (~87 tok)

## cmd/triage/

- `main.go` — rapid-issue-triage: a local-only, keyboard-first rapid triaging tool for (~862 tok)
  - fn `main` L28-41 (~135 tok)
  - fn `run` L42-104 (~452 tok)
  - fn `openBrowser` L105-119 (~80 tok)

## internal/ai/

- `enrich.go` — shells out to the Claude Code CLI (no API key required) to (~1362 tok)
  - class `Enricher` L18-23 (~23 tok)
  - class `result` L24-37 (~130 tok)
  - fn `Enrich` L38-82 (~434 tok)
  - fn `timeout` L83-91 (~47 tok)
  - fn `parseResult` L92-107 (~142 tok)
  - fn `buildPrompt` L108-143 (~476 tok)
  - fn `truncate` L144-150 (~27 tok)

## internal/config/

- `config.go` — loads rapid-triage configuration from YAML with sane (~844 tok)
  - class `Config` L15-27 (~137 tok)
  - class `SyncConfig` L28-34 (~52 tok)
  - class `AIConfig` L35-46 (~119 tok)
  - fn `Default` L47-62 (~166 tok)
  - fn `Load` L63-97 (~214 tok)
  - fn `APIKey` L98-105 (~71 tok)

## internal/linear/

- `api.go` — Declares issueFields (~1530 tok)
  - fn `Viewer` L15-22 (~64 tok)
  - fn `Teams` L23-33 (~99 tok)
  - fn `WorkflowStates` L34-37 (~54 tok)
  - fn `Labels` L38-41 (~45 tok)
  - fn `Projects` L42-45 (~40 tok)
  - fn `Cycles` L46-51 (~83 tok)
  - fn `Users` L52-57 (~78 tok)
  - fn `paginate` L58-102 (~303 tok)
  - fn `filterTypeFor` L103-114 (~64 tok)
  - fn `Issues` L115-147 (~259 tok)
  - fn `IssueComments` L148-166 (~170 tok)
  - fn `UpdateIssue` L167-189 (~187 tok)
- `client.go` — is a minimal GraphQL client for the Linear API, covering the (~710 tok)
  - class `Client` L17-21 (~17 tok)
  - fn `New` L22-25 (~33 tok)
  - class `gqlError` L26-30 (~39 tok)
  - fn `Do` L31-89 (~503 tok)
  - fn `truncate` L90-96 (~32 tok)
- `types.go` — Ref (54 fields) (~627 tok)
  - class `Ref` L3-6 (~13 tok)
  - class `User` L7-14 (~57 tok)
  - class `Team` L15-20 (~29 tok)
  - class `WorkflowState` L21-29 (~65 tok)
  - class `Label` L30-37 (~50 tok)
  - class `Project` L38-43 (~31 tok)
  - class `Cycle` L44-52 (~65 tok)
  - class `Issue` L53-76 (~215 tok)
  - class `Comment` L77-86 (~68 tok)
  - class `PageInfo` L87-91 (~30 tok)

## internal/server/

- `handlers.go` — applyRequest (84 fields); methods: PrefetchEnrichments (~3069 tok)
  - fn `handleMeta` L16-30 (~98 tok)
  - fn `handleQueue` L31-52 (~186 tok)
  - fn `handleIssueContext` L53-79 (~246 tok)
  - class `applyRequest` L80-85 (~39 tok)
  - fn `handleApply` L86-108 (~160 tok)
  - fn `handleRunMacro` L109-136 (~207 tok)
  - fn `handleSkip` L137-161 (~198 tok)
  - fn `handleSnooze` L162-190 (~237 tok)
  - fn `handleEnrich` L191-231 (~283 tok)
  - fn `commentsText` L232-270 (~292 tok)
  - fn `handleUndo` L271-293 (~156 tok)
  - fn `handleListMacros` L294-302 (~64 tok)
  - fn `handleCreateMacro` L303-320 (~108 tok)
  - fn `handleUpdateMacro` L321-343 (~138 tok)
  - fn `handleDeleteMacro` L344-356 (~92 tok)
  - fn `validateMacro` L357-371 (~110 tok)
  - fn `handleReport` L372-380 (~52 tok)
  - fn `handleSyncStatus` L381-384 (~34 tok)
  - fn `handleSyncRefresh` L385-391 (~82 tok)
  - fn `PrefetchEnrichments` L392-433 (~241 tok)
- `ops.go` — Declares Op (~2030 tok)
  - fn `resolveOps` L18-134 (~921 tok)
  - fn `labelDisplay` L135-142 (~47 tok)
  - fn `prevSnapshot` L143-149 (~71 tok)
  - fn `applyOps` L150-192 (~416 tok)
  - fn `undoActivity` L193-253 (~451 tok)
- `server.go` — exposes the local HTTP API and serves the embedded web UI. (~901 tok)
  - class `Server` L19-29 (~77 tok)
  - fn `New` L30-33 (~54 tok)
  - fn `Handler` L34-57 (~350 tok)
  - fn `spaHandler` L58-75 (~121 tok)
  - fn `writeJSON` L76-83 (~65 tok)
  - fn `writeErr` L84-87 (~36 tok)
  - fn `decodeBody` L88-95 (~68 tok)
  - fn `bgCtx` L96-97 (~18 tok)

## internal/store/

- `activity.go` (~1310 tok)
  - fn `LogActivity` L8-19 (~123 tok)
  - fn `GetActivity` L20-33 (~157 tok)
  - fn `MarkActivityUndone` L34-39 (~60 tok)
  - fn `Report` L40-153 (~956 tok)
- `enrichments.go` (~378 tok)
- `issues.go` — Declares issueCols (~2209 tok)
  - fn `UpsertIssue` L14-35 (~327 tok)
  - fn `Begin` L36-39 (~62 tok)
  - fn `PruneStale` L40-51 (~128 tok)
  - fn `scanIssue` L52-72 (~282 tok)
  - fn `Queue` L73-109 (~252 tok)
  - fn `GetIssue` L110-116 (~73 tok)
  - fn `QueueCount` L117-128 (~82 tok)
  - fn `MarkSkipped` L129-133 (~43 tok)
  - fn `MarkSnoozed` L134-139 (~55 tok)
  - fn `MarkTriaged` L140-145 (~60 tok)
  - fn `RestoreIssue` L146-156 (~162 tok)
  - fn `ApplySyncedIssue` L157-169 (~131 tok)
  - fn `SetIssueContext` L170-175 (~58 tok)
  - fn `GetIssueContext` L176-186 (~116 tok)
  - fn `UnenrichedQueueHeads` L187-207 (~166 tok)
  - fn `TeamCounts` L208-228 (~126 tok)
- `macros.go` (~488 tok)
- `metadata.go` — Replace-all upserts for workspace metadata. Each runs in the caller's sync (~1457 tok)
  - fn `replaceAll` L8-24 (~100 tok)
  - fn `ReplaceTeams` L25-28 (~45 tok)
  - fn `ReplaceStates` L29-33 (~62 tok)
  - fn `ReplaceLabels` L34-38 (~54 tok)
  - fn `ReplaceProjects` L39-42 (~48 tok)
  - fn `ReplaceCycles` L43-47 (~58 tok)
  - fn `ReplaceUsers` L48-53 (~74 tok)
  - fn `Metadata` L54-101 (~525 tok)
  - fn `LabelIDByName` L102-110 (~112 tok)
  - fn `StateIDByName` L111-117 (~71 tok)
  - fn `StateIDByType` L118-124 (~71 tok)
  - fn `StateType` L125-130 (~54 tok)
  - fn `ActiveCycleID` L131-138 (~80 tok)
  - fn `MyUserID` L139-144 (~48 tok)
- `models.go` — View models served to the frontend. (~886 tok)
  - class `LabelChip` L5-10 (~32 tok)
  - class `IssueRow` L11-33 (~262 tok)
  - class `Enrichment` L34-43 (~86 tok)
  - class `Macro` L44-55 (~133 tok)
  - class `MacroStep` L56-69 (~219 tok)
  - class `Activity` L70-83 (~139 tok)
- `store.go` — owns the local sqlite database: the issue index, skip/snooze (~1166 tok)
  - class `Store` L16-19 (~10 tok)
  - fn `Open` L20-37 (~137 tok)
  - fn `Close` L38-39 (~16 tok)
  - fn `migrate` L40-122 (~715 tok)
  - fn `now` L123-126 (~24 tok)
  - fn `SetMeta` L127-132 (~58 tok)
  - fn `GetMeta` L133-142 (~65 tok)
  - fn `mustJSON` L143-150 (~33 tok)
  - fn `errRow` L151-157 (~31 tok)

## internal/syncer/

- `syncer.go` — indexes Linear metadata and untriaged issues into sqlite in (~1958 tok)
  - class `Status` L17-24 (~76 tok)
  - class `Syncer` L25-37 (~60 tok)
  - fn `New` L38-46 (~98 tok)
  - fn `Run` L47-63 (~86 tok)
  - fn `Kick` L64-70 (~23 tok)
  - fn `Status` L71-92 (~153 tok)
  - fn `doSync` L93-112 (~90 tok)
  - fn `syncOnce` L113-242 (~938 tok)
  - fn `refID` L243-250 (~40 tok)
  - fn `toRow` L251-278 (~224 tok)
  - fn `ToRow` L279-280 (~19 tok)
  - fn `creatorName` L281-290 (~51 tok)

## web/

- `index.html` — Rapid Triage (~80 tok)
- `package-lock.json` — npm lock file (~23887 tok)
- `package.json` — Node.js package manifest (~186 tok)
- `tsconfig.json` — TypeScript configuration (~130 tok)
- `vite.config.ts` — Vite build configuration (~107 tok)

## web/src/

- `styles.css` — Styles: 19 rules, 125 vars, 6 animations, 1 layers (~2249 tok)

## web/src/components/ui/

- `button.tsx` — buttonVariants (~583 tok)
  - section `ButtonProps` L33-42 (~111 tok)
- `dialog.tsx` — Dialog — uses useEffect (~464 tok)
- `picker.tsx` — Keyboard-first fuzzy picker popover: input on top, arrow-navigable list, (~1259 tok)
  - section `PickerOption` L7-15 (~41 tok)
  - fn `Picker` L16-133 (~1135 tok)
- `select.tsx` — Styled native select: fastest possible dropdown, fully keyboard accessible. (~240 tok)
- `toast.tsx` — Minimal toast system with an optional Undo action. (~602 tok)
  - section `Toast` L6-12 (~30 tok)
  - section `ToastCtx` L13-17 (~50 tok)
  - fn `useToast` L18-19 (~14 tok)
  - fn `ToastProvider` L20-59 (~445 tok)

## web/src/lib/

- `api.ts` — Thin fetch wrapper over the local Go API. (~782 tok)
  - class `ApiError` L4-9 (~33 tok)
  - fn `req` L10-65 (~709 tok)
- `colors.ts` — Teams come from Linear dynamically; give each a stable, readable hue. (~150 tok)
- `store.tsx` — Global app state: metadata, macro list, the card deck, and every triage (~3589 tok)
  - section `Card` L21-27 (~31 tok)
  - section `TriageCtx` L28-63 (~215 tok)
  - fn `useTriage` L64-72 (~52 tok)
  - fn `TriageProvider` L73-386 (~3106 tok)
- `theme.tsx` — Ctx — uses useState, useEffect, useCallback, useContext (~334 tok)
- `types.ts` — Shared types mirroring the Go server's JSON payloads. (~855 tok)
  - section `LabelChip` L3-8 (~23 tok)
  - section `Enrichment` L9-18 (~72 tok)
  - section `Issue` L19-41 (~130 tok)
  - section `Team` L42-42 (~18 tok)
  - section `WorkflowState` L43-43 (~35 tok)
  - section `Label` L44-44 (~29 tok)
  - section `Project` L45-45 (~20 tok)
  - section `Cycle` L46-46 (~34 tok)
  - section `User` L47-48 (~29 tok)
  - section `SyncStatus` L49-56 (~46 tok)
  - section `Meta` L57-72 (~104 tok)
  - section `Op` L73-86 (~72 tok)
  - section `Macro` L87-95 (~49 tok)
  - section `Comment` L96-102 (~39 tok)
  - section `ActivityItem` L103-115 (~69 tok)
  - section `Report` L116-127 (~71 tok)
- `utils.ts` — Exports cn, timeAgo, fmtMs, PRIORITY_NAMES (~282 tok)
