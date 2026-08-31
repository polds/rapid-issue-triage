# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-08-31T17:37:33.039Z
> Files: 137 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.gitattributes` — Git attributes (~375 tok)
- `.gitignore` — Git ignore rules (~183 tok)
- `.golangci.yml` — Declares is (~1950 tok)
- `.goreleaser.yaml` (~2481 tok)
- `.tool-versions` (~4 tok)
- `AGENTS.md` — OpenWolf (~68 tok)
- `CLAUDE.md` — CLAUDE.md — working in `rapid-issue-triage` (~3258 tok)
- `Dockerfile` — Release runtime image: COPYs GoReleaser's prebuilt `$TARGETPLATFORM/triage` onto pinned distroless, OCI labels from build args, binds 0.0.0.0:7333 as uid 65532 with /data as $HOME (~1170 tok)
- `go.mod` — Go module definition (~151 tok)
- `go.sum` — Go dependency checksums (~1199 tok)
- `LICENSE` — Project license (~3029 tok)
- `Makefile` — Make build targets (~4331 tok)
- `rapid-triage.example.yaml` — Rapid Triage configuration. Copy to ./rapid-triage.yaml or (~467 tok)
- `README.md` — Project documentation (~3159 tok)
- `SECURITY.md` — Security Policy (~627 tok)
- `webui.go` — embeds the built frontend (web/dist) into the binary. (~84 tok)

## .githooks/

- `pre-commit` — Mirror the CI quality gates, scoped to what this commit actually touches. (~867 tok)

## .github/

- `CLAUDE.md` — .github/ — CI, security scanning, releases (~5323 tok)
- `dependabot.yml` — Declares for (~804 tok)
- `zizmor.yml` — zizmor audit configuration. Every entry here is a deliberate, reviewed (~453 tok)

## .github/workflows/

- `ci.yml` — CI: CI (~4659 tok)
- `codeql.yml` — CodeQL security-extended over Go + TypeScript, PR and weekly (~555 tok)
- `dependabot-auto-merge.yml` — Auto-merges patch/minor Dependabot PRs behind all required checks; holds majors and release-only actions (~1439 tok)
- `release.yml` — CI: Release (~2188 tok)
- `scorecard.yml` — OpenSSF Scorecard, SARIF to the Security tab (~359 tok)

## cmd/triage/

- `CLAUDE.md` — Startup order, flags, the hidden `triage tool` shim (~719 tok)
- `main.go` — rapid-issue-triage: a local-only, keyboard-first rapid triaging tool for (~1629 tok)

## internal/

- `CLAUDE.md` — internal/ — Go packages (~979 tok)

## internal/ai/

- `CLAUDE.md` — Fast enrichment: verdict set, prompt/truncation invariants (~656 tok)
- `enrich.go` — shells out to the Claude Code CLI (no API key required) to (~1365 tok)

## internal/config/

- `CLAUDE.md` — internal/config — YAML config + credential lookup (~682 tok)
- `config_test.go` — TestExpandHome, TestLookupEnvThenDotenv, TestEnvFileValueQuotesExportAndComments, TestLoadYAMLAndPageSizeClamp + 3 more (~1455 tok)
- `config.go` — loads rapid-triage configuration from YAML with sane (~1464 tok)

## internal/deep/

- `claude.go` — streamOpts (56 fields) (~1218 tok)
- `CLAUDE.md` — Scout fanout, the credential boundary, run lifecycle, report schema (~1317 tok)
- `orchestrator.go` — Orchestrator (83 fields); methods: ValidateToken, Subscribe, LogToolCall, Start (~2935 tok)
- `scouts.go` — scoutDef (30 fields) (~2169 tok)
- `toolbox.go` — implements deep AI enrichment: a fanout of read-only scout (~3261 tok)

## internal/linear/

- `api.go` — CustomView (89 fields); methods: Viewer, Teams, WorkflowStates, Labels (~2596 tok)
- `CLAUDE.md` — internal/linear — minimal Linear GraphQL client (~839 tok)
- `client.go` — is a minimal GraphQL client for the Linear API, covering the (~873 tok)
- `types.go` — Ref (54 fields) (~682 tok)

## internal/server/

- `CLAUDE.md` — internal/server — local HTTP API + embedded UI (~1639 tok)
- `deep.go` — HTTP handlers: sendSSE (~1660 tok)
- `handlers.go` — applyRequest (80 fields) (~4924 tok)
- `labelgroups_test.go` — TestGroupsWithSiblingsKeepsOnlyClashes, TestClassifyGroupSplitsIncomingFromExisting, TestClassifyGroupTwoIncomingIsNotResolvable, TestClassifyGroup... (~1429 tok)
- `labelgroups.go` — labelGroupConflict (45 fields); methods: Error (~1691 tok)
- `ops.go` — opOptions (153 fields) (~3443 tok)
- `pickfolder_test.go` — TestCanceledDetection (~107 tok)
- `pickfolder.go` (~1044 tok)
- `reportcomment_test.go` — TestLinearIssueURL (~160 tok)
- `reportcomment.go` — deepReport (54 fields) (~1373 tok)
- `server.go` — exposes the local HTTP API and serves the embedded web UI. (~1546 tok)
- `settings.go` — ClaudeAvail (35 fields) (~990 tok)
- `version_test.go` — TestHandleVersionShape, TestHandleVersionCheckDisabled (~720 tok)
- `version.go` — versionResponse (2 fields) (~358 tok)

## internal/store/

- `activity.go` (~1434 tok)
- `CLAUDE.md` — internal/store — sqlite: the only persistence layer (~1113 tok)
- `enrichments.go` — IssueContentHash (~711 tok)
- `enrichruns.go` — EnrichRun (46 fields); methods: CreateEnrichRun, FinishEnrichRun, GetEnrichRun, LatestRunForIssue (~1188 tok)
- `enrichsettings.go` — EnrichSettings gates deep enrichment. Every source is read-only by (~396 tok)
- `issues.go` — Declares issueCols (~2245 tok)
- `macros.go` (~488 tok)
- `metadata.go` — Replace-all upserts for workspace metadata. Each runs in the caller's sync (~1797 tok)
- `models.go` — View models served to the frontend. (~1097 tok)
- `queuefilter.go` — QueueFilter (19 fields); methods: Empty (~646 tok)
- `secrets_test.go` — TestSecretsRoundTripAndHint, TestHintMasks (~383 tok)
- `secrets.go` — Secrets (36 fields); methods: GetSecrets, SetSecret, Resolve, SecretStatus (~890 tok)
- `store_test.go` — TestMetaRoundTrip, TestQueueFilterEmpty, TestIssueQueueSkipSnoozeTriageAndFilters, TestMacrosCRUD + 5 more (~3703 tok)
- `store.go` — owns the local sqlite database: the issue index, skip/snooze (~1585 tok)

## internal/syncer/

- `CLAUDE.md` — Generation-based sync, stale vs reindexing semantics (~689 tok)
- `syncer.go` — indexes Linear metadata and untriaged issues into sqlite in (~2648 tok)

## internal/update/

- `update_test.go` — TestCheckFindsNewerRelease, TestCheckUpToDateAndDevBuild, TestCheckNoReleasesIsNotAnError, TestCheckErrorsKeepLastGoodResult + 4 more (~1923 tok)
- `update.go` — checks GitHub for a newer released version, on a timer, in (~2196 tok)

## internal/version/

- `version_test.go` — TestParse, TestCompareAndIsNewer, TestIsNewerRejectsUnparseable, TestResolveStamped + 3 more (~1259 tok)
- `version.go` — carries this binary's build stamp and knows how to order (~1567 tok)

## web/

- `CLAUDE.md` — web/ — the embedded frontend (~1411 tok)
- `eslint.config.js` — ESLint flat configuration (~1902 tok)
- `index.html` — Rapid Triage (~80 tok)
- `package.json` — Node.js package manifest (~349 tok)
- `tsconfig.json` — TypeScript configuration (~130 tok)
- `vite.config.ts` — Vite build configuration (~146 tok)
- `vitest.config.ts` — Vitest test configuration (~264 tok)

## web/scripts/

- `check-licenses.mjs` — Dependency license gate for the frontend tree. (~1581 tok)

## web/src/

- `App.tsx` — Hash-based page switch (triage | macros | reports) — no router dependency, (~400 tok)
- `main.tsx` (~153 tok)
- `styles.css` — Styles: 22 rules, 134 vars, 6 animations, 1 layers (~2475 tok)

## web/src/components/

- `CLAUDE.md` — web/src/components/ — shared components + two subtrees (~844 tok)
- `ErrorBoundary.tsx` — A render crash anywhere below must not blank the whole app: show what (~596 tok)
- `Markdown.tsx` — Inline markdown (bold, code, links) without wrapping block elements. (~2141 tok)
- `PriorityIcon.tsx` — Linear priorities: 0 none, 1 urgent, 2 high, 3 medium, 4 low. (~282 tok)

## web/src/components/triage/

- `ActionBar.tsx` — OUTCOME_VARIANT (~621 tok)
- `CLAUDE.md` — web/src/components/triage/ — the triage screen (~1257 tok)
- `Confetti.tsx` — TONES — renders chart — uses useState, useCallback, useEffect (~726 tok)
- `DeepPanel.tsx` — Deep enrichment UI: live per-scout progress + Claude-Code-style thinking (~5250 tok)
- `DuplicateOfPicker.tsx` — "Duplicate of…" picker: Linear requires a duplicate relation before an (~1688 tok)
- `FilterPanel.tsx` — Queue-source panel: pick a saved Linear view (its filter becomes the index (~2692 tok)
- `HelpOverlay.tsx` — SHORTCUTS — renders modal (~482 tok)
- `IssueCard.tsx` — VERDICT_META — uses useState, useMemo, useEffect (~4631 tok)
- `LabelGroupPrompt.tsx` — Linear label groups hold one label per issue. When a macro or a quick edit (~1181 tok)
- `NotificationBell.tsx` — Bell dropdown tracking background enrichments. Clicking an entry jumps (~1445 tok)
- `QuickEditRow.tsx` — Quick edit: fast keyboard pickers that apply single-field ops to the (~2269 tok)
- `report-format.ts` — VERDICT_META + deep report -> Linear markdown (not a component) (~776 tok)
- `ShortcutBar.tsx` — ITEMS (~335 tok)
- `TopBar.tsx` — SyncPill — renders chart — uses useState (~1853 tok)

## web/src/components/ui/

- `button.tsx` — buttonVariants (~583 tok)
- `CLAUDE.md` — Primitive kit and its keyboard-first contract (~560 tok)
- `dialog.tsx` — Dialog — uses useEffect (~567 tok)
- `picker.tsx` — Keyboard-first fuzzy picker popover: input on top, arrow-navigable list, (~1334 tok)
- `select.tsx` — Styled native select: fastest possible dropdown, fully keyboard accessible. (~240 tok)
- `toast.tsx` — Minimal toast system with an optional Undo action. (~658 tok)
- `use-toast.ts` — ToastContext + useToast, split from toast.tsx for react-refresh (~147 tok)

## web/src/lib/

- `api.ts` — Thin fetch wrapper over the local Go API. (~2168 tok)
- `CLAUDE.md` — web/src/lib/ — state, transport, types, pure helpers (~1352 tok)
- `colors.test.ts` — Declares key (~300 tok)
- `colors.ts` — Teams come from Linear dynamically; give each a stable, readable hue. (~150 tok)
- `enrichmode.test.ts` — Declares enrichSettings (~618 tok)
- `enrichmode.ts` — Tiny module-level cache of enrichment settings so every card doesn't (~238 tok)
- `labelgroups.test.ts` — "Area" is a group; infrastructure and ci-cd are its exclusive children. (~1679 tok)
- `labelgroups.ts` — Linear label groups are mutually exclusive: only one child of a group may be (~1324 tok)
- `linear.test.ts` — Declares from (~309 tok)
- `linear.ts` — linearIssueHref: identifier + template URL -> Linear issue URL (~129 tok)
- `linearfilter.test.ts` — Mirrors what linear.app puts in ?filter=: base64url, padding stripped. (~571 tok)
- `linearfilter.ts` — decodeLinearFilterURL: base64url ?filter= -> IssueFilter JSON (~246 tok)
- `store.tsx` — Global app state: metadata, macro list, the card deck, and every triage (~7013 tok)
- `theme.tsx` — Ctx — uses useState, useEffect, useCallback, useContext (~334 tok)
- `triage-context.ts` — The triage context object, its accessor hook, and the deck types they (~931 tok)
- `types.ts` — Shared types mirroring the Go server's JSON payloads. (~2214 tok)
- `utils.test.ts` — Declares enabled (~633 tok)
- `utils.ts` — Exports cn, timeAgo, fmtMs, PRIORITY_NAMES (~282 tok)
- `version.test.ts` — Declares info (~1381 tok)
- `version.ts` — Pure formatting for the build stamp and the update check. The server decides (~869 tok)

## web/src/lib/ (tests)

- `colors.test.ts`, `enrichmode.test.ts`, `linear.test.ts`, `linearfilter.test.ts`, `utils.test.ts` — 33 tests over the pure logic modules (~1500 tok)

## web/src/pages/

- `CLAUDE.md` — web/src/pages/ — the four hash routes (~882 tok)
- `Macros.tsx` — Macro management: user-defined one-key action sequences. (~5158 tok)
- `Reports.tsx` — Gamified report page: stat tiles, per-day bar chart, outcome donut, (~2998 tok)
- `Settings.tsx` — Enrichment settings: fast vs deep mode, per-source toggles with live (~6130 tok)
- `Triage.tsx` — TriagePage — uses useState, useCallback, useEffect (~2327 tok)
