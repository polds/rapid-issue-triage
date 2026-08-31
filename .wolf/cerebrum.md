# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-08-31 (version display + background update check; previously 2026-08-28: directory-level CLAUDE.md tree; cerebrum union policy reconciled; OpenWolf CLI bootstrap)

## User Preferences

- Wants Claude-missing warnings on both the issue card and Settings, plus an Advanced override for the `claude` binary path.
- Wants MCP API keys (Linear, GitHub, Datadog) settable in the Settings UI rather than env-only.
- Wants the running version visible in the app and a periodic background check for a newer one — placement left to judgement (top bar, footer, or Settings were all offered).
- Wants golangci-lint near-pedantic, with **gocyclo min-complexity 15** as a hard cap so agents cannot dump kitchen-sink functions. Style-war rules (lll, noctx, fieldalignment, forbidigo, revive exported comments) stay disabled so CI remains green.

## Key Learnings

- **Project:** rapid-issue-triage
- **Agent docs are a tree, not one file.** The root `CLAUDE.md` is an index
  (architecture, non-negotiables, vocabulary, maintenance triggers) that links
  to 16 directory-level `CLAUDE.md` files. Read the root plus the one directory
  you are touching - not the whole set. Each directory file carries a layout
  table, its invariants, its path-scoped lint exclusions, and a "when you
  change X update Y" block. The OpenWolf block in the root is wrapped in
  `<!-- openwolf:begin/end -->` markers (like AGENTS.md) so a future
  `openwolf init` rewrites only that block and leaves the index alone.
- Surfaces that drift silently, documented in the maintenance tables because
  nothing in CI checks them: Go JSON tags vs `web/src/lib/types.ts`; the route
  table vs `web/src/lib/api.ts`; the deep-report schema across
  `deep/scouts.go` + `server/reportcomment.go` + `triage/report-format.ts`; the
  keyboard map across `pages/Triage.tsx` + `HelpOverlay.tsx` + README.
- `react-refresh/only-export-components` is an **error** in this repo, which is
  why `lib/triage-context.ts`, `ui/use-toast.ts` and `triage/report-format.ts`
  exist as separate files. A new context, hook, or constant goes in a sibling
  `.ts`, never next to a component.
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

- `no-explicit-any` was blinding rules that were already enabled. `any` short-circuits type-aware analysis, so enforcing it surfaced 5 pre-existing `no-base-to-string` errors that had been silently unreachable. Expect a type-safety rule to uncover violations of its neighbours.
- All 12 previously deferred ESLint rules are enforced as of main `cb8b536`. `npm run lint` is 0 errors / 2 warnings (both `exhaustive-deps` in store.tsx).
- `web/dist` is tracked because `webui.go` embeds it - `go install .../cmd/triage@latest` does not compile without it - and nothing verified it still matched `web/src`. It had been stale since `d7f6ae7`. `make web-dist-check` rebuilds and diffs; two consecutive Vite builds are byte-identical, so the comparison is reproducible.

### OpenWolf tooling in Claude Code (2026-08-28)
- **The committed hooks and the CLI are two separate things.** `.wolf/hooks/*.js`
  are tracked, dependency-free ESM run directly by node, so they fire on a fresh
  clone with no install. The `openwolf` **CLI** is a global npm install and is
  *not* in the repo - and Claude Code on the web uses ephemeral containers, so it
  is absent every session unless something reinstalls it. Symptom: hooks work
  fine, nothing looks broken, but `openwolf scan` / `find` / `designqc` are all
  "command not found" and anatomy.md silently drifts. Fixed by
  `.claude/hooks/session-start.sh`, registered first in SessionStart.
- That bootstrap's `openwolf init` step never runs here: it guards on `.wolf/`
  existing, and `.wolf/` is tracked in this repo. That is the correct behavior -
  init would re-register hooks that are already committed. The install is the
  whole point of the script here; in a repo that gitignores `.wolf/` the init
  branch is what matters.
- **`openwolf scan` (v2.5.0) renders a much leaner anatomy.md** than older
  versions: 543 lines -> 189 for this tree. Per-symbol lines (`fn foo L12-30`)
  are no longer written into the markdown; they live in `.wolf/anatomy-index.json`
  and are retrieved on demand with `openwolf find <symbol>` / `openwolf map`.
  Nothing is lost - do not "restore" the symbol lines by hand.
- The scan **absorbs hand-written descriptions** from anatomy.md, as OPENWOLF.md
  promises - the CLAUDE.md descriptions written by hand survived the regenerate
  verbatim. It also stopped indexing `.claude/`, `.codex/` and `.cursor/`, which
  older output covered. That is the tool's call; re-adding those sections by hand
  just makes the index churn (see the note in `.wolf/hooks/post-write.js`).

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
- **`cerebrum.md` is union too, as of PR #35** (2026-08-28) - superseding the
  original "never widen union past memory.md" call. It is append-mostly (12 of
  16 changes over the last 500 commits deleted no lines), and union's failure
  mode here - a duplicated section when a rewrite collides with an append - is
  visible in markdown and repairable. The rationale lives in `.gitattributes`.
- Still never union: the `.wolf` JSON state files (two appends interleave into
  invalid JSON that git reports as a *successful* merge), `STATUS.md`, and the
  generated `anatomy.md` - all rewritten in place rather than appended to, so
  union duplicates sections. `.gitattributes` names exactly two files; keep it
  that way.
- **A newly added `merge=union` line does not apply to the merge that
  introduces it.** Git reads merge attributes from the `.gitattributes` already
  on the branch you are merging *into*, so the rule only takes effect from the
  next merge onward. Verified empirically on PR #36: merging main (which
  carried the new cerebrum union line) into a branch whose `.gitattributes`
  predated it conflicted on `cerebrum.md` while `memory.md` resolved silently;
  replaying the identical merge with the line pre-staged auto-resolved
  `cerebrum.md`. So expect one last manual conflict on any file the moment you
  union it - that is not the rule failing.

- **Running the app offline is a solved problem — use the run skill.**
  `.claude/skills/run-rapid-issue-triage/` holds `driver.mjs` (Playwright) and
  `fixture.mjs` (a seeded workspace). `driver.mjs smoke` boots the binary with a
  fake `LINEAR_API_KEY`, seeds six issues and three macros into a sandboxed
  sqlite db under `.run-sandbox/`, and drives the real page: skip, snooze,
  `Space`, `?`, and all four routes, with screenshots. Do not re-derive this by
  hand; the whole point is that a fresh db renders "Inbox zero", not an error.
- **The offline read/write split.** With a fake key the UI is fully usable
  because everything the deck needs is served from sqlite. Only two routes are
  live Linear passthroughs — `/api/views` and `/api/issues/{id}/context` — and
  they 502. Skip and snooze are local writes and work; macros, the pickers, and
  undo all funnel through `resolveOps` → `applyOps` → `issueUpdate` and 502.
  This is the cleanest available probe of whether something has drifted off the
  local index.
- **`claude` is on PATH and authenticated in the web container**
  (`/opt/node22/bin/claude`), so AI enrichment genuinely runs — `POST
  /api/issues/{id}/enrich` returns a real summary and verdict in ~20s.
  Enrichments ride along in the `/api/queue` payload, so a card enriched
  out-of-band keeps showing "No AI context" until the deck is refetched.
- **Playwright 1.56.1 is installed globally** at
  `/opt/node22/lib/node_modules/playwright`, with browsers in `/opt/pw-browsers`
  — not in `web/node_modules`, so a bare `import 'playwright'` will not resolve
  from this repo. Import it by absolute path. `node:sqlite` (`DatabaseSync`) is
  available on Node 22 and is the cheapest way to poke the index from a script.
### Container releases (2026-08-28)
- GoReleaser's **`dockers_v2`** (v2.12+) replaces `dockers` + `docker_manifests`.
  It builds with `docker buildx` in the **publish phase**, not the build phase,
  because buildx cannot assemble a multi-platform manifest without pushing it.
  So `--skip=publish` / `goreleaser build` silently produce no image at all, and
  `release --snapshot` instead builds one `--load`ed image per platform with a
  `-linux-amd64` tag suffix. That snapshot path is the dry run that proves the
  Dockerfile before a real tag does.
- The docker build context is a **temp dir holding only artifacts**, laid out as
  `<goos>/<goarch>[/v<arm>]/<binary>` — the same string as `$TARGETPLATFORM`, so
  `COPY $TARGETPLATFORM/triage /usr/bin/` is the whole Dockerfile. Repo files are
  absent unless listed in `extra_files` (no wildcards).
- The runner's **default buildx driver is `docker`, which cannot cross-build**;
  `docker/setup-buildx-action` (docker-container driver) is required. QEMU is
  not: a COPY-only Dockerfile never executes anything for the target platform.
- **Labels and annotations are not interchangeable.** Labels live in the image
  config and can come from Dockerfile `ARG`s (so a hand build gets them);
  annotations live on the index and the per-platform manifests and can only come
  from `dockers_v2.annotations`, scoped `index,manifest:`. `.BaseImage` /
  `.BaseImageDigest` are parsed off the `FROM` line, so pinning the base by
  digest also makes `org.opencontainers.image.base.*` exact and drift-free.
- `docker_digest` writes `dist/digests.txt` in checksum-file shape purely so
  `actions/attest` can take it as `subject-checksums`, giving images the same
  provenance as the archives. It does not exist on a snapshot run.
- Distroless `static:nonroot` sets `User=65532` but **no `HOME`**, and Go's
  `os.UserHomeDir` reads the env, not `/etc/passwd`. Without `ENV HOME=...` the
  sqlite index lands in a relative `.rapid-triage/`. BuildKit creates a `WORKDIR`
  owned by the image's current user, which is what makes a named volume at
  `/data` writable without a `RUN chown` (there is no shell to run one).
- Docker Hub rate-limits anonymous pulls (429 seen from this container). Another
  reason the base image comes from `gcr.io`: a rate-limited pull inside a release
  is a failed release.
- zizmor's `unpinned-tools` audit fires on `with: version: ${{ steps.x.outputs.y }}`
  even when the expression resolves to a Makefile pin. It is a false positive
  here but a real pattern elsewhere, so it is suppressed inline
  (`# zizmor: ignore[unpinned-tools]` **on the finding's own line**, not on the
  `- uses:` line above it — a comment on the step is ignored) rather than by
  adding a file-wide entry to `.github/zizmor.yml`. Curiously
  `golangci/golangci-lint-action` uses the identical shape and is not flagged.
- `osv-scanner --output` is deprecated in v2.5; it is `--output-file`. It exits
  1 when it finds something *and still writes the report*, so one invocation is
  both the gate and the SARIF producer.
- A new gate added as a **step of an existing CI job** is enforced immediately;
  a new **job** is not, until someone edits the `Main` ruleset's required
  checks. Prefer the step when the risk belongs to a job that already exists.

- Linear **label groups are mutually exclusive**: a group is an `IssueLabel`
  with `isGroup: true`, its children carry `parent`, and only one child per
  group may sit on an issue. Violating it fails the whole `issueUpdate` with
  `labelIds not exclusive child labels` — no field name, no label names. The
  same rule applies to project labels. Anything that assembles `labelIds` has
  to know the parent edge, so `labels.parent_id` is load-bearing, not metadata.
- The **detect → prompt → re-run with the answer** shape is now used twice in
  the write path: `duplicateOf` (Linear needs the relation before a
  duplicate-type state) and `replaceGroupLabels` (a group already holds a
  sibling). Both pre-flight in the UI against synced metadata and re-check on
  the server, which stays the authority. A third constraint of this kind should
  follow the same shape rather than inventing a new one.
- A pre-flight that mirrors a server rule has to mirror **all** of it. The Go
  side skips the group check when no label op ran (`labelsChanged`), because
  the update then carries no `labelIds` at all; the TS port omitted that guard
  and would have prompted on a `set_state`-only macro over an issue that
  already violated a group. Its own test caught it — port the guards, not just
  the happy path.

- **Semgrep's `string-formatted-query` rule is shape-sensitive, and the store
  already has the shape that passes.** A dynamic `IN (...)` written as
  `q := "SELECT ... (?" + strings.Repeat(...) + ")"` then `db.Query(q, args...)`
  is flagged; `issues.go:85` builds the same clause by appending (`q += ...`)
  to an existing variable and is not. Bind args were never the issue in either.
  Use `placeholders(n)` from `queuefilter.go` and append — don't add a
  `nosemgrep`, and don't open-code `strings.Repeat` a third time.
- **semgrep *can* be run locally here**, contrary to the "not installed" skip.
  A plain `pip install --user` produces a broken binary: `pysemgrep` imports
  `jwt` → `cryptography`, which resolves to the system
  `/usr/lib/python3/dist-packages` copy and dies with a pyo3 PanicException.
  A clean venv works, but only after deleting the broken `/root/.local/bin`
  entry point, which shadows it on PATH:
  `python3 -m venv v && v/bin/pip install semgrep==1.175.0 && rm -f
  /root/.local/bin/{semgrep,pysemgrep,osemgrep}`, then put `v/bin` on PATH.
  Worth doing before pushing anything that builds SQL or shells out — `make ci`
  silently skips the gate otherwise and CI catches it instead.

### The Claude Code CLI reports its own token usage — never estimate it

Both `claude -p --output-format json` and `--output-format stream-json` end
with a result object carrying the *same* fields: `usage`
(`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`), `total_cost_usd`, `duration_ms`, and a
`modelUsage` map keyed by real model id. Anything asking "how many tokens did
enrichment use" is a *capture* problem, not an estimation problem — probe the
CLI before writing a token counter.

Two gotchas worth remembering:
- `modelUsage` contains a cheap housekeeping model (Haiku) alongside the model
  that actually answered. Pick the **highest-cost** entry to name the model;
  `dominantModel` in `internal/ai` and `internal/deep` does this, and it
  matters because `ai.model` / config is usually empty.
- `total_cost_usd` carries `"costBasis":"list"`. On a Claude subscription no
  money changes hands per call, so it is a list-price *equivalent* — the
  reports page says so rather than presenting it as a bill.
- **`debug.ReadBuildInfo()` is the free half of a version stamp, but
  `Main.Version` lies on a local build.** GoReleaser stamps `main.version` via
  `-ldflags`; a plain `go build` stamps nothing and the toolchain synthesizes a
  pseudo-version (`v0.0.0-<14-digit timestamp>-<12 hex>`, sometimes
  `vX.Y.Z-0.<timestamp>-<hash>`) that parses as a valid semver prerelease.
  `vcs.revision` and `vcs.time` from the same call are trustworthy; the version
  is not. `internal/version.Resolve` rejects the pseudo-version and keeps
  "dev", which is also what stops a dev build from being nagged to "upgrade".
- **The app now has exactly three outbound destinations**: Linear, the local
  `claude` binary, and (switchable) one GET a day to GitHub's public releases
  endpoint. That list is a stated non-negotiable in the root CLAUDE.md — a
  fourth needs a reason in the PR and a line in SECURITY.md.
- **`go fix -diff` is a CI gate (`make ci-go` → `fix-check`), and `usetesting`
  is on.** New Go tests must use `t.Context()`, not
  `context.Background()`/`context.WithCancel(context.Background())` — the
  latter fails the build before golangci-lint even runs.
- **`make web-dist-check` reads only the worktree column of `git status`.**
  After a UI change, `git add web/dist` and it passes; running it on an
  unstaged rebuild always fails, which looks like a real drift and is not.
- **A `createPortal` child ignores its ancestors' CSS.** Responsive layouts
  here duplicate components and hide one copy with `xl:hidden` / `hidden
  xl:flex`. That hides in-flow markup only — a portalled modal renders to
  `document.body` and escapes it, so a duplicated component that renders one
  shows the modal twice, stacked, each with its own state. Overlays belong to
  the page that owns the shared open-state, not to the duplicated subtree.

- [2026-08-31] **Deep runs are pooled, and the pool is a user-visible state, not
  just a throttle.** `Orchestrator.Start` no longer launches: it enqueues and
  calls `drain`, which starts up to `MaxConcurrent` (default 2,
  `ai.max_concurrent`) and re-announces everyone still waiting. `enrich_runs`
  therefore has a third status, `queued`, ahead of `running` — anything that
  tested `status != "running"` for "finished" (the SSE poll, `FailOrphanRuns`)
  had to learn about it. `started_at` stays the *enqueue* time: it orders the
  line and is what the user actually asked for.
- [2026-08-31] **A queue position reaches the browser as an event, not a field.**
  `announce` emits `orchestrator`/`status` `{state:"queued", position}` only
  when a run's place actually changes, and the SSE stream is the single thing
  the card panel and the bell read. The POST's `Placement` response is just the
  first of those states, so the UI never has two sources of truth to reconcile.
- [2026-08-31] **In `internal/deep`, `o.mu` protects bookkeeping only.** `drain`
  snapshots what to launch and what to announce, unlocks, and only then writes
  to sqlite and emits — `emit` takes the *run's* mutex and hits the database, so
  doing either under `o.mu` would serialise every run behind one slow write.
- [2026-08-31] **`noticeIsActive` is the client's whole concurrency rule.** One
  predicate (queued **or** running) decides what the card renders, what can be
  dismissed, and whether pressing `i` again enqueues a duplicate. A pooled run
  can wait minutes, which is exactly the window in which a user presses the key
  a second time — the guard is not theoretical.
- [2026-08-31] **The run-skill driver now has `hover <sel>`.** Tailwind
  `group-hover` affordances are invisible to `eval`/`getComputedStyle` without a
  real pointer; `page.hover` then `shot` is how you screenshot one. It times out
  if the selector matches nothing — and notices are client-side state, so a repl
  restart wipes them.

## Do-Not-Repeat

- [2026-08-31] Do not answer a missing sqlite row with a bare `writeErr(w, 404,
  err)`. The syncer's `PruneStale` deletes every issue that leaves the index
  filter, and the browser's deck is a snapshot — so "row not found" is usually
  an ordinary race, not a bad id, and it reached the user as
  "Action failed: not found" with the card rolled back onto a keystroke that
  could never clear it. A vanished row is a *state*, not a failure: give it a
  machine-readable code, an explanation, and a UI path that moves on. Also,
  404-ing every `GetIssue` error hid real database faults behind the same
  message; only `store.ErrNotFound` is a 404.
- [2026-08-31] Toast text must fit **one 420px line** — `toast.tsx` renders it
  in a `truncate` span. "ENG-208 is no longer in the index — triaged or closed
  in Linear" was cut mid-sentence in the running app. Match the existing toasts
  ("Skipped ENG-355") and keep it under ~50 characters.
- [2026-08-31] Do not render a portalled overlay from a component the layout
  mounts more than once. `QuickEditRow` is mounted twice by `TriagePage` for the
  two breakpoints, so the Labels picker portalled two panels to `document.body`
  and only one of them tracked what the user typed — the other sat behind it
  showing the full list. The responsive `xl:` classes could not hide it because
  the portal is not their descendant. Split the buttons from the modals.
- [2026-08-31] Do not let a Linear constraint surface as Linear's own error
  text. `labelIds not exclusive child labels` reached the user as
  "Action failed: …" after the card had already swiped away, naming neither the
  group nor either label, and offering nothing to do about it. A constraint the
  local index can evaluate should be evaluated locally, *before* the mutation,
  and turned into a choice. Reserve the raw error for the case the index cannot
  see (a group created since the last sync) and rewrite it there too.
- [2026-08-31] Never run `npx tsc` in `web/` without checking `node_modules`
  exists. With no install, npx silently fetches a *different* TypeScript (6.0.2
  vs. the pinned ^5.7.0) and reports errors the project does not have — the
  first one was a `baseUrl` deprecation in `tsconfig.json` that does not fail
  the real build. Run `npm ci` first, then `npx tsc -b`.
- [2026-08-28] Never run `pkill -f <pattern>` where the pattern also occurs in
  the command you are typing. `-f` matches full command lines including the
  shell running the Bash tool call, so it kills its own caller: the tool
  returns exit 144 with no output at all and nothing explains why. Kill by pid
  (or scan `/proc/*/exe`) instead — `driver.mjs stop` does.
- [2026-08-28] Do not wipe a table with an `AUTOINCREMENT` id and assume ids
  restart. `DELETE FROM macros` leaves `sqlite_sequence` alone, so a re-seed
  hands out ids 10, 11, 12 and `POST /api/issues/{id}/macro/1` 404s. Clear
  `sqlite_sequence` for the table too.
- [2026-08-28] Do not assert a UI state with a loose `text=` Playwright
  selector. `text=/skip|snooze/i` matched the card's own action buttons, so the
  help-overlay check waited on six elements and timed out. Anchor on a heading
  the target screen uniquely owns (`h2:text-is("Keyboard shortcuts")`).
  Relatedly, `App.tsx pageFromHash()` silently falls back to the triage page
  for any unrecognised hash, so `#/report` (the route is `reports`) renders the
  wrong screen while the assertion still passes.
- [2026-08-28] Do not trust `.wolf/anatomy.md` as a complete file list. The
  2026-08-28T02:20 scan tracked 90 files and silently omitted five real
  modules (`web/src/lib/linear.ts`, `linearfilter.ts`, `triage-context.ts`,
  `components/ui/use-toast.ts`, `components/triage/report-format.ts`) plus
  `.golangci.yml`, `.goreleaser.yaml`, `.githooks/pre-commit` and two test
  files. Use it to decide whether to read a file, never to decide whether a
  file exists - `git ls-files <dir>` is the authority.
- [2026-08-28] Do not apply `merge=union` to any JSON file, however append-only it looks. `.wolf/buglog.json` measured 8/10 append-only changes, but two concurrent appends union into interleaved keys inside a single object (`"fix": "a"` immediately followed by `"id": ...`), which is invalid JSON - and git reports it as a *successful* merge, so nothing warns you. A conflict is strictly better than silent corruption. Same reasoning bars go.sum and lockfiles.
- [2026-08-28] Do not untrack `web/dist/`, however much it churns (26 tracked files, #3 by commit count). `webui.go` declares `//go:embed all:web/dist`, so the tree must be present at compile time; without it `go build` fails and `go install` from the module proxy has no Node toolchain to regenerate it. The churn is the deliberate price of installability. Note that merely running `npm run build` rewrites the hashed bundle and index.html, so revert `web/dist/` before committing unrelated work.
- [2026-08-28] Do not expect `.gitattributes merge=union` to keep a PR out of GitHub's conflicted state. It is applied by local git only. PR #31 proved it: with `.gitattributes` present `git merge-tree HEAD origin/main` returned a clean tree (exit 0), the identical merge with the file stripped hit `CONFLICT (content) in .wolf/memory.md`, and GitHub reported `mergeable_state: dirty` throughout. Worse, a conflicted PR produces no merge ref, so the `pull_request` workflows never run and the required checks silently never report - the PR looks stalled rather than conflicted. The fix is the same as always: merge the base branch locally, where union resolves it without a prompt, and push the merge commit. Union saves the manual conflict edit, not the merge commit.
- [2026-08-27] Do not gate MCP key fields on `src.enabled`. Datadog then showed "set keys in Settings" with no inputs. Always render secret rows for sources that declare them.
- [2026-08-27] Never commit `.wolf/dashboard-token`. It is the OpenWolf dashboard auth secret (64-hex, mode 0600). Roll by deleting the file; the next `openwolf dashboard` / daemon start mints a new one. Gitignore it.
- [2026-08-27] Go 1.27 rejects `QueueFilter{}.Empty()` (struct-literal field selector). Write `(QueueFilter{}).Empty()`.
- [2026-08-28] Do not assume a merged release-config fix applies to an existing tag. Publishing tag X checks out X's tree, and GoReleaser reads `.goreleaser.yaml` from there - only the workflow YAML comes from the dispatched ref. A tag cut before the fix stays broken forever; re-tag it or move to a new version. This is why v0.1.0 was abandoned for v0.1.1.
- [2026-08-28] Do not put `dist/*.spdx.json` in `release.extra_files`. SBOMs are already first-class GoReleaser artifacts that it uploads itself; the glob double-queues all 42 and the release dies on `422 already_exists`. `checksum.extra_files` is the one that should keep them (checksums.txt subjects only, no upload).
- [2026-08-28] A green `--snapshot` run proves nothing about uploading. Snapshot never touches the Releases API, so upload-path bugs (duplicate asset names, immutability, auth) survive any number of green dry runs and detonate on the first real tag.
- [2026-08-28] Never create the GitHub Release by hand in the Releases UI while immutable releases are on. It publishes instantly, GoReleaser then cannot attach any archive/SBOM/checksum, the run fails on preflight, and the tag name is burnt permanently — the version must be bumped. Let the workflow create the release.
- [2026-08-28] Do not treat a green Release run as a published release. Run 33144134442 succeeded, built every archive/SBOM, and created nothing, because a `workflow_dispatch` from `main` took the `--snapshot` branch. Check the run's resolved GoReleaser version (`8aa5c68-snapshot`, `tag: v0.0.0`) and whether the attestation step was skipped.

- [2026-08-28] Do not land an ESLint gate whose rules cannot pass, and do not leave the deferral open-ended either. The first type-checked run produced 127 errors, so the noisy families (`no-unsafe-*` from `res.json()` being `any`, `no-floating-promises`, the React Compiler rules) were turned off with a written reason in eslint.config.js to keep the debt visible in review. **Resolved 2026-08-28**: all of them were re-enabled one rule per PR (#23-#30, #32, #33). eslint.config.js now has no deferred block; the only `off` left is the deliberate test-file override for `react-refresh/only-export-components`. Deferring is a staging tactic, not an end state.
- [2026-08-28] Do not assume a tool failing locally means CI is broken. `make lint` and `make vuln` both failed here on the go1.26/go1.27 toolchain mismatch while every CI run on main was green - CI uses a prebuilt golangci-lint binary and a setup-go environment. Check the actual run conclusions before reporting a red pipeline.

- [2026-08-28] Do not trust a green local `actionlint`. It shells out to shellcheck for `run:` blocks only when shellcheck is on PATH, and silently skips them otherwise while still exiting 0. GitHub runners have it; dev containers often do not. `make actions-lint` now warns locally and hard-fails in CI when it is missing.
- [2026-08-28] Do not run zizmor without `--no-online-audits` unless a GitHub token is present. Unauthenticated it does not degrade, it panics with a 401 and performs no audit at all.
- [2026-08-28] A pre-commit hook must not just call `make ci`. Scope each gate to the staged paths (Go / web / workflows), or a one-line web tweak pays for the Go race suite and people start using --no-verify.

- [2026-08-28] Do not rename a CI job without checking the `Main` ruleset's required status checks. Renaming `web.name` from "Web typecheck and build" to "Web lint, test, build" left the required check waiting for a name nothing reports any more, so PR #16 sat `blocked` with all 14 checks green. Required checks match by exact string, and adding a matrix renames a job too (`Job name (leg)`). Read the ruleset with `curl /repos/OWNER/REPO/rulesets/<id>` before touching a job name.

- [2026-08-28] Never add the `creation` rule to the `Release Tags` tag ruleset (21759998) without first adding a bypass actor. `release.yml`'s `create_tag` path pushes `refs/tags/$RELEASE_TAG` with `GITHUB_TOKEN`, which holds no bypass permission, so restricting creations makes every tag push 403 and the release path dies. Enabling it requires a GitHub App token (`actions/create-github-app-token`) or a deploy key registered as a bypass actor. Same reason `required_signatures` stays off: the runner's `git tag -a` is unsigned.

- [2026-08-28] Do not put `tag_name_pattern` (or any metadata-restriction rule: `branch_name_pattern`, `commit_message_pattern`, `commit_author_email_pattern`) in a ruleset for this repo. It is a user-owned repo, and those rules 422 with `Invalid rule 'tag_name_pattern':`. The structural rules (`creation`, `update`, `deletion`, `non_fast_forward`) do work here - the "Release Tags" ruleset uses three of them. Semver enforcement therefore lives only in release.yml's own regex guard, which is fine: the release trigger glob is `v*.*.*`, so a non-semver tag cannot fire a release.
- [2026-08-28] Do not combine a scoped Dependabot `commit-message.prefix` with `include: "scope"`. Dependabot appends its own `(deps)` / `(deps-dev)` scope to whatever prefix you give it, so `prefix: "build(backend)"` plus `include: scope` emits `build(backend)(deps): ...`, which is not a valid Conventional Commit. Pick one: either the area lives in the prefix's scope (what this repo does) or you let Dependabot own the scope with `deps`.
- [2026-08-28] Do not set `IFS=','` to split Dependabot's `dependency-names` while a space-separated allow/hold list is also being split in the same scope. The inner `for held in $held_actions` then sees one long word and matches nothing, so the hold list silently passes everything - an auto-merge gate that always says yes. Translate with `tr ',' ' '` and leave IFS alone. Caught only because the step's script was extracted from the YAML and run against a truth table; actionlint and shellcheck both pass on it.
- [2026-08-28] Do not expect `pull_request` to work for Dependabot auto-merge. Workflows Dependabot triggers get a read-only GITHUB_TOKEN, so `gh pr merge --auto` 403s. `pull_request_target` is the documented fix and keeps a writable token because the PR's *base* ref (main) is not Dependabot-created. zizmor flags it `dangerous-triggers`/high; the exception is justified only because the workflow has no `actions/checkout` - never add one to that file.
- [2026-08-28] Do not consolidate this repo's Go CLI tools into one `tools/go.mod` with `tool` directives to get Dependabot tracking them. A shared module runs MVS across every tool's graph: actionlint v1.7.9 requires `go.yaml.in/yaml/v4 v4.0.0-rc.3`, golangci-lint v2.13.2 pulls the same module to rc.6, and rc.6's breaking API change (`yaml.ParserError`, `e.Line`) means actionlint no longer compiles - `make actions-lint` dies. `go run <tool>@<version>` is immune because each tool builds against its own go.mod. If tracking is ever wanted, it needs one module per tool, not one shared one. (Measured: a shared module was 230 lines of go.mod and 956 of go.sum.)
- [2026-08-28] Do not write a Make target that captures a tool's stdout and only tests emptiness: `out="$(tool)"; if [ -n "$out" ]; then fail; fi` reads a *tool crash* as a clean run, because errors go to stderr and the capture comes back empty. `make quality` shipped that way for one iteration and printed "no unreachable functions" while deadcode was failing to build the packages. Always trap the assignment: `out="$(tool)" || { echo ...; exit 1; }`.
- [2026-08-28] Do not run `deadcode -test ./cmd/triage` and believe the result. `-test` only adds the *listed* packages' tests as entry points, so anything exercised solely by `internal/store`'s own tests reads as unreachable - it flagged `store.MarkTriaged` and `QueueFilter.Empty`, both of which are tested. Use `deadcode -test $(GO_PKGS)`.
- [2026-08-28] Do not trust an empty grep without checking the shell's cwd first. A `grep -rn ... .` that "proved" two Go functions had no callers had actually run from `web/` after a previous `cd` moved the working directory. Two functions were deleted on the strength of it and `go fix -diff` caught the breakage.
- [2026-08-28] Do not interpolate `${{ steps.x.outputs.y }}` into a `run:` block - zizmor flags it `template-injection` and the workflow lint job goes red. The repo's existing pattern is the fix: resolve the value inside the shell, `"semgrep==$(make -s print-SEMGREP_VERSION)"`.
- [2026-08-28] `.PHONY: print-%` does nothing - make does not expand patterns in .PHONY. Verified by creating a file named `print-TESTVAR`, which shadowed the rule and printed nothing. Use a `FORCE` prerequisite if a pattern rule genuinely needs phony protection; do not list the pattern and assume it is covered.

- [2026-08-28] `void somePromise` does not satisfy `react-hooks/set-state-in-effect`. The rule tracks the setter call, not the floating promise, so `void load()` inside an effect still reports. The shape that passes is an IIFE the effect owns: `void (async () => { ... })()`. Reaching for `void` because `no-floating-promises` is also on will silence one rule and leave the other red.

- [2026-08-28] Do not close and reopen a PR to kick CI, ever. On a *conflicted* PR it does nothing anyway - no merge ref means the `pull_request` workflows never fire and the PR shows **zero** check runs, not failures. The fix is to merge the base branch in and resolve. Reopening #26 only cancelled 8 in-flight runs and dropped the event subscription.

- [2026-08-28] Do not deduplicate check runs by name and keep an arbitrary one. A re-run leaves several runs sharing a name (cancelled, queued, in progress); keeping whichever the API returned first reported "7 required checks failing" on #26 when nothing was failing. Sort by `started_at` and keep the latest run per name.

- [2026-08-28] A worktree-isolated agent must verify its cwd before its first edit. One fan-out agent edited the shared checkout's `web/eslint.config.js` instead of its own worktree, putting an unrelated rule into the main tree. The scratchpad directory is shared across agents too, not per-agent; two agents writing `commit-msg.txt` overwrote each other.

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

- [2026-08-28] Dependabot auto-merge is gated on `patch`/`minor` only, plus a hold list of actions that **no pull request ever executes**: `actions/attest`, `anchore/sbom-action`, `goreleaser/goreleaser-action`, `ossf/scorecard-action`. Those live solely in release.yml / scorecard.yml, so CI only lints the workflow file - a bad bump surfaces at release time, and a failed release burns a tag name permanently. Every other action is also used by ci.yml or codeql.yml, so the PR's own run validates it. Auto-merge changes no gate: `--auto` queues behind all 11 required contexts, and the Main ruleset needs 0 approvals, so nothing waits on a human review.
- [2026-08-28] CI has no `paths:` filters - every job runs on every PR. That is what makes auto-merge safe here (no required context can go permanently unreported) and should stay that way; adding a path filter to a required job would hang every PR that misses it.

- [2026-08-28] Pinned tool versions live in the Makefile and CI reads them through `make -s print-<VAR>`, rather than each workflow repeating the literal. Only golangci-lint and zizmor were duplicated (ci.yml had `version: v2.13.2` and `zizmor==1.29.0`); govulncheck and actionlint were already single-source because CI calls `make vuln` / `make actions-lint`. None of the four is Dependabot-tracked - it bumps `uses:` refs only, never a version a make target hands to `go run` or `pip` - so they are bumped by hand, and the point of the change is that a hand bump can no longer leave a stale copy in a workflow.
- [2026-08-28] `.wolf/cerebrum.md` joined `.wolf/memory.md` under `merge=union` (PR #35), reversing the earlier "union stops at memory.md" call. The trade-off was accepted knowingly: cerebrum is append-mostly, so union removes a conflict that has no decision in it, and when it does misfire (a rewrite colliding with an append) it duplicates a markdown section — loud and repairable. That is categorically unlike union on JSON, which yields invalid output git reports as a clean merge. `STATUS.md` stays excluded because it is rewritten in place every phase, which is union's actual bad case. Scope is two files, named explicitly in `.gitattributes`; widening it further needs the same append-mostly evidence.

- [2026-08-28] SAST is semgrep, installed from PyPI at a Makefile pin, not `semgrep/semgrep-action`. The action wants a Semgrep AppSec Platform token and ships findings to a SaaS backend; this project binds to 127.0.0.1 precisely so nothing leaves the machine, and CI should not be the exception. Rulesets are `p/golang`, `p/gosec`, `p/typescript`, `p/react`, `p/secrets` - one engine reading Go and TSX both, so the two halves cannot end up held to different rules. It does not replace CodeQL: different rule authors, and unlike CodeQL this one is a make target a contributor runs before pushing. Both upload SARIF, so findings land side by side in the Security tab.
- [2026-08-28] License policy is two-tier, because the audiences differ. Go modules and npm's `.prod` tree are all redistributed inside one binary (npm's half via `web/dist` + `go:embed`), so both are held to an explicit allow-list. Dev-only npm packages never leave the machine, so they only clear a copyleft/source-available deny-list. `dependency-review-action` carries the same deny-list for what a PR adds - a deny-list rather than an allow-list there because it reports "unknown" for anything it cannot classify, and an allow-list would fail those instead of the licenses that matter.
- [2026-08-28] The npm license check is `npm query .prod --json` parsed by a 90-line script, not `license-checker`. A license auditor added to inspect the supply chain is itself supply chain - the obvious candidate pulled in ~40 transitive packages including two deprecated ones. `npm query` is built into npm 8.16+ and returns the `license` field per node.
- [2026-08-28] go-licenses needs `--confidence_threshold=0.8`. Its classifier is old enough that at the 0.9 default `modernc.org/mathutil` classifies as Unknown and `make licenses` fails on a BSD-2-Clause module. 0.8 classifies every module in this graph correctly; `make licenses-report` is there to re-verify after a dependency change.
- [2026-08-28] Frontend code quality is `eslint-plugin-sonarjs` at its recommended set with a curated disable list - deliberately the same shape `.golangci.yml` gives the backend. Before it, Go had gocyclo/dupl/unused/revive and the frontend had nothing equivalent. Needs v4+ for ESLint 10 peer support (v3 pins eslint 9 and installs a second copy). `sonarjs/cognitive-complexity` is capped at 25, not 15: cognitive complexity counts nesting harder than cyclomatic does, so the same number is a much tighter cap - 25 is where the largest existing reducer sits, and the rule is still "split the function", never raise it.
- [2026-08-28] sonarjs earned its place on the first run: `super-linear-regex` found real ReDoS in `Markdown.tsx`, the one file that parses untrusted Linear-authored text. Empirically 4x input -> 17x time. The rules turned off are the ones that fight decisions already made (`void-use` vs. the documented fire-and-forget convention, `pseudo-random` for confetti, `prefer-read-only-props`); the bug-finding rules all stayed on and their findings were fixed.
- [2026-08-28] `make ci` now includes `quality` and `ci-security` (`vuln` + `sast` + `licenses`), closing a pre-existing gap where `make vuln` was gated by CI but not by `make ci` despite the doc calling it "everything CI gates on". The developer loop stays fast because the pre-commit hook is path-scoped, not because `make ci` is incomplete. `sast` is deliberately absent from the hook: it needs network and ~40s, and a per-commit cost like that is how you teach people to reach for `--no-verify`.

- [2026-08-28] Re-enabled the deferred lint rules as one PR per rule, fanned out to an agent each, rather than one sweeping PR. Every PR touched the same deferred block in eslint.config.js, so conflicts were constant - the cost of the approach. It bought reviewable, revertable diffs and let each agent root-cause its own rule; two real bugs (Confetti re-randomizing mid-burst, 5 hidden `no-base-to-string` errors) were found that a bulk suppression pass would have buried.
- [2026-08-28] The `web/dist` freshness gate verifies rather than regenerates: it fails a PR whose committed bundle does not match a fresh build, instead of a bot rebuilding and committing. A workflow that pushes generated output needs write access on every PR and turns an unreviewed build into a commit. It rides in the existing `Web lint, test, build` job rather than a new one, so the `Main` ruleset's required contexts do not change. It reads only the worktree column of `git status`, so an already-staged rebuild passes - otherwise the pre-commit hook could never be satisfied.
- [2026-08-28] The release publishes a container to `ghcr.io/polds/rapid-issue-triage` built from the **binaries GoReleaser already produced**, not from source in a builder stage: a rebuild inside the image would ship bytes that the archives' checksums and the SLSA provenance do not cover. Tags are `{{.Version}}`, `{{.Major}}.{{.Minor}}`, and `latest`, the last two suppressed on a prerelease. No bare `{{.Major}}` tag while the project is 0.x — a moving `0` would promise a compatibility semver does not give before 1.0. Image tags are also *not* immutable the way the GitHub Release is: a re-run overwrites them, which is fine because the attestations pin digests.
- [2026-08-28] The container binds `0.0.0.0:7333`, which is not a retreat from the loopback-only rule: inside a network namespace, loopback is reachable from nothing, so the bind address stops being the control. The control moves to the port publish — `-p 127.0.0.1:7333:7333` — and is stated in the Dockerfile, README, SECURITY.md, and the root CLAUDE.md non-negotiables, because `/api/pick` and `/api/toolbox` spawn subprocesses.
- [2026-08-28] The Dockerfile base image joins the Dependabot hold list (`docker` ecosystem, `build(docker)` scope). No pull request builds the image, so a base bump is exactly as unvalidated as a bump to an action that only release.yml runs — same reason, same list.
- [2026-08-28] A PR whose `mergeable_state` is `dirty` shows **zero** CI runs, not failing ones: a conflicted PR has no merge ref, so `pull_request`-triggered workflows never fire and every required context reads as absent. STATUS.md already recorded this; PR #41 hit it within a minute of being opened. Check `mergeable_state` before concluding CI is slow or a workflow trigger is wrong.
- [2026-08-29] Do not compare SPDX license ids as raw strings. Every GPL-family license has two spellings -- modern `LGPL-3.0-only` / `GPL-2.0-or-later` and deprecated bare `LGPL-3.0` -- so a policy list written in one spelling silently passes the other. The license gate shipped that way and let `eslint-plugin-sonarjs` (LGPL-3.0-only) through a deny-list containing `LGPL-3.0`; socket-security[bot] noticed, the gate did not. Normalise (strip `-only`/`-or-later`/`+`) before comparing, and make a policy matcher self-test on every run -- a gate that fails open is worse than no gate, and this one was invisible.
- [2026-08-29] The npm license policy is two tiers, and the tiers are not the same list on purpose. `dependency-review-action` pins `fail-on-scopes: runtime` and carries the strict deny-list (it only ever judges redistributed code); the Makefile's `WEB_LICENSE_DENY` is the dev-only tier and deliberately omits LGPL/MPL/EPL, because a lint plugin is *executed*, never conveyed, and copyleft obligations attach to conveying. Flattening the two would either let copyleft into the shipped binary or ban an LGPL lint plugin for no benefit. Decision made by the user on PR #41 after the gate correctly flagged sonarjs.
- [2026-08-28] Surveyed GitHub's Actions → New workflow → Security catalogue (~76 starter workflows) and adopted exactly two: **OSV-Scanner** and **Trivy**. Every commercial entry (Snyk, SonarQube/SonarCloud, Codacy, Checkmarx, Veracode, Fortify, Contrast, Black Duck, JFrog/Frogbot, Endor, Prisma, Sysdig, Zscaler, Mayhem, NowSecure, StackHawk, SOOS, Debricked, APIsec) is token-gated SaaS — the same objection that already rules out `semgrep/semgrep-action` here, plus a fork PR never holds the secret and the check would silently no-op. The rest are other languages or absent infrastructure (Terraform, K8s, mobile, Azure).
- [2026-08-28] Rejected the `eslint.yml` starter workflow specifically. Its only addition over the existing `Web` job is a Security-tab SARIF feed, bought with a new redistributable dependency (`@microsoft/eslint-formatter-sarif`) for the license gate to judge — and eslint is already a *blocking* gate, so alerting adds nothing. Security-tab alerts earn their keep for scanners that warn, not for checks that already fail the build.
- [2026-08-28] Rejected hadolint: the Dockerfile is `COPY`-only on distroless with no `RUN` layer, so its `DL3xxx` rules have nothing to match, and semgrep `p/dockerfile` already reads the file.
- [2026-08-28] OSV-Scanner is a hard gate despite overlapping govulncheck, because govulncheck filters by reachability and users compile this binary themselves from a tree they can configure differently. It is also the only path by which an npm finding reaches the Security tab — `npm audit` only prints to a console. Deliberate exceptions belong in an `osv-scanner.toml`, not in a narrower `--lockfile` list.
- [2026-08-28] Trivy scans **the base image off the Dockerfile's `FROM` line**, not a pulled `ghcr.io` tag. It needs no registry auth, works on a PR that has published nothing, is deterministic, and tracks the digest Dependabot bumps — Dependabot moves the pin but cannot say whether today's pin has a CVE. Two passes on one warm DB: everything into SARIF, then a HIGH/CRITICAL `--ignore-unfixed` gate, because an unfixable Debian CVE blocking every merge only teaches people to bypass the hook.
- [2026-08-28] Both new scanners went in as **steps of the existing `Security` job**, not as new jobs, so no `Main` ruleset edit was needed and the gates are enforced from the first run. The required-check count stays at 14.
- [2026-08-31] A label-group clash returns **409 with a structured body**
  (`code`, `conflicts`, `resolvable`), not the 502 every other apply/macro
  failure gets. 502 means "Linear said no"; this is the user's own action
  conflicting with a rule, and the UI needs the group and both label names to
  render a choice rather than a message. `writeActionErr` is the seam — new
  user-resolvable failures belong there, everything else stays 502.
- [2026-08-31] "Replace" is offered **only when the action adds exactly one
  sibling**. Two incoming siblings (a macro listing both) or two pre-existing
  ones give no basis for picking a winner, so the prompt explains the clash and
  offers only Cancel. Guessing there would silently drop a label the user asked
  for — the one outcome worse than the original error.
- [2026-08-31] The update check is server-side, in memory, and unauthenticated. Alternatives considered: persisting the last result in sqlite (rejected — it would mean new DDL in `internal/store` for a value whose staleness costs one HTTP GET per restart), and comparing versions in the frontend (rejected — `update.available` is one verdict from one implementation, `internal/version.IsNewer`, and the UI only decides how to phrase it). The checker is a leaf package holding no credentials and reading no local state, so the one request it makes stays trivially auditable; `update_check.enabled: false` is the kill switch and has a test asserting no request is made.
- [2026-08-31] `GET /repos/{owner}/{repo}/releases/latest` rather than `/tags` or the GraphQL API: it excludes drafts and prereleases server-side, needs no auth, and returns the `html_url` to link to. 404 (a fork with no releases) is treated as an empty result, not a failure; 403/429 gets its own "rate limit, will retry" message. The configured repo is regexp-validated as `owner/name` so a config value can never steer the request at another host or path.

### 2026-08-31 — Token usage is recorded per *responsibility*, not per run

`token_usage` tags every LLM call with the agent that made it (`fast`, each
deep scout, `synthesis`) rather than only the run. That tag is the whole point
of the reports breakdown: "deep enrichment cost $X" is much less useful than
"the repo scout is 40% of the bill". The table is deliberately **not** joined
to `issues` — `PruneStale` deleting an issue must not rewrite spend history.

Usage is returned from `Enrich`/`claudeStream` **on the error paths too**: a
scout that timed out still spent its tokens, and dropping that silently would
make the panel under-report exactly when spend is worst. `RecordTokenUsage`
no-ops on an all-zero row, so a call that died before spending anything does
not inflate the call count.

- [2026-08-31] Skip and snooze **retire** a card the sync pruned; macros and
  quick edits do **not**. Skip/snooze are local bookkeeping on the row itself,
  so with the row gone there is nothing to record, nothing to undo, and no
  reason to report a failure — the card is marked `gone` and the deck advances.
  A macro is a Linear write that did not happen; retiring its card would read
  as "applied". It keeps the card pending and shows the (now explanatory) error,
  and the user can clear it with Skip.
- [2026-08-31] `issue_gone` rides the same `ApiError.code` seam as
  `label_group_conflict`: a 404 body carrying `{error, code}`. The seam is now
  established for both 409 and 404 — a new failure the UI should *act* on gets
  a code, not a special-cased message match.

- [2026-08-31] Bounded deep enrichment **server-side in the orchestrator**, not client-side in `store.tsx`. The runs are server-owned goroutines that outlive the tab, `enrich_runs` is where their status already lives, and a browser-side limiter would be per-tab and would lie after a reload. Scoped to deep runs only: fast enrichment is one synchronous `claude -p` per request, already one-at-a-time per click, and produces no notice to show a "waiting" state on.
- [2026-08-31] Default pool size 2 (`ai.max_concurrent`), and `Load` clamps a configured 0 back to 2. One deep run is already a fanout of `claude` subprocesses across every enabled source plus a synthesis pass, so 2 is roughly "keep one core free on a laptop being triaged on". Clamping matters because an omitted YAML key leaves the zero value, and 0 would mean enrichment silently never starts.
- [2026-08-31] Dismissal is offered on **finished notices only**, not on queued or running ones. The notice is the client's only record of a live run — dropping one would orphan the run, blank the card panel, and re-enable the enrich key for an issue already in the queue. Cancelling a queued run is a different feature (it needs a server endpoint to remove it from the pool) and was deliberately left out.
