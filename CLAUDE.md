# CLAUDE.md — working in `rapid-issue-triage`

A local-only, single-binary, keyboard-first triaging tool for Linear backlogs.
*Tinder for backlog triage*: one issue as a card, one keystroke per decision,
with user-defined macros, AI enrichment via the Claude Code CLI, and a
gamified report page.

Go HTTP server + sqlite index + a Vite/React SPA embedded with `go:embed`.
Binds `127.0.0.1:7333` only — no services, no deploys, no API keys leaving the
machine.

<!-- openwolf:begin -->
# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.
<!-- openwolf:end -->

## Read first, every session

1. **[`.wolf/STATUS.md`](.wolf/STATUS.md)** — current quest, next phase, open
   and closed decisions. Replaces re-reading plans and code to rebuild context.
2. **[`.wolf/cerebrum.md`](.wolf/cerebrum.md)** — Do-Not-Repeat, user
   preferences, decision log. Check before generating code.
3. **[`.wolf/anatomy.md`](.wolf/anatomy.md)** — per-file descriptions +
   token estimates. Check before reading a file; the description is often
   enough. Regenerate with `openwolf scan` after adding or renaming files.
4. **The directory CLAUDE.md for whatever you're touching** — the table below.

On demand: [`README.md`](README.md) (user-facing: setup, keyboard map,
release process), [`SECURITY.md`](SECURITY.md),
[`rapid-triage.example.yaml`](rapid-triage.example.yaml),
[`.wolf/buglog.json`](.wolf/buglog.json) (read **before** fixing a bug — the
fix may already be known).

## Directory index

Each of these carries that directory's invariants, layout, and gotchas.
Reading the relevant one is faster and cheaper than re-deriving the layout.

| Directory | Covers |
|---|---|
| [`cmd/triage/`](cmd/triage/CLAUDE.md) | The binary: startup order, flags, and the hidden `triage tool` shim scouts exec. |
| [`internal/`](internal/CLAUDE.md) | Package map + dependency direction + the conventions all Go packages share. |
| [`internal/store/`](internal/store/CLAUDE.md) | sqlite: **all DDL**, queue ordering, `sync_gen` pruning, secrets, the report query. |
| [`internal/server/`](internal/server/CLAUDE.md) | HTTP API, route table, and the single Linear write path (`resolveOps` → `applyOps` → undo). |
| [`internal/syncer/`](internal/syncer/CLAUDE.md) | Background Linear → sqlite indexing; stale/reindexing semantics. |
| [`internal/linear/`](internal/linear/CLAUDE.md) | Hand-written GraphQL client; the shared-pointer `SetAPIKey` contract. |
| [`internal/deep/`](internal/deep/CLAUDE.md) | Deep enrichment: scout fanout, the credential-free tool shim, streamed events, report schema. |
| [`internal/ai/`](internal/ai/CLAUDE.md) | Fast enrichment: one `claude -p` call → summary + verdict. |
| [`internal/config/`](internal/config/CLAUDE.md) | YAML config, defaults, and the env/`.env` credential lookup. |
| [`web/`](web/CLAUDE.md) | Frontend root: build, embedding, routing, and the lint contracts. |
| [`web/src/lib/`](web/src/lib/CLAUDE.md) | Global state, fetch wrapper, wire types, and the pure modules that carry the coverage floor. |
| [`web/src/components/`](web/src/components/CLAUDE.md) | Shared components; why `Markdown.tsx` is hand-written. |
| [`web/src/components/triage/`](web/src/components/triage/CLAUDE.md) | The triage screen; index filter vs. view filter. |
| [`web/src/components/ui/`](web/src/components/ui/CLAUDE.md) | Primitive kit and its keyboard contract. |
| [`web/src/pages/`](web/src/pages/CLAUDE.md) | The four hash routes; the keyboard map; Settings invariants. |
| [`.github/`](.github/CLAUDE.md) | CI, CodeQL, Scorecard, Dependabot, and the release traps. |

## Architecture in one pass

```
Linear GraphQL API
   ↑ writes (issueUpdate)          ↓ reads (paginated, filtered)
internal/server ────────────── internal/syncer          background, on a ticker
   │  resolveOps → applyOps         │ generation-stamped upsert + prune
   │                                ↓
   ├──────────────────────── internal/store (sqlite)    the ONLY source the UI reads
   │                                ↑
   ├── internal/ai      fast: one claude -p call
   └── internal/deep    deep: scouts → `triage tool` shim → POST /api/toolbox
                                                              ↑ the only path to a credential
web/ (embedded SPA) ── fetch /api/* ── internal/server
```

**The load-bearing idea:** the UI is always served from sqlite, never from
Linear. A slow or failed sync degrades to *stale* — visible in the top bar —
never to *broken*.

## Non-negotiables

- **All SQL lives in `internal/store`**, and all DDL in its `schema` const.
  The database ships on user machines: migrations are additive, never
  destructive.
- **Credentials resolve Settings → env → `.env`**, via `store.Resolve` or
  `config.Lookup`. Never `os.Getenv` for a secret. **No API response ever
  contains a secret value** — only `{set, source, hint}` with a masked last-4.
- **Deep-enrichment agents hold no credentials.** They exec a `triage-tool`
  shim that POSTs to `/api/toolbox`; the server holds the keys, executes a
  read-only implementation, and logs the call. Every toolbox verb must stay
  read-only.
- **Loopback only.** `/api/toolbox` and `/api/pick` spawn subprocesses; that
  is acceptable solely because the listener is `127.0.0.1`. Do not bind
  elsewhere without revisiting both.
- **Untrusted text is Linear-authored.** Issue bodies and comments render
  through the hand-written `Markdown.tsx`; there is no
  `dangerouslySetInnerHTML` in the tree and ESLint bans the adjacent escape
  hatches. Keep it that way.
- **`gocyclo` caps Go functions at complexity 15.** Split the function; do not
  raise the cap. golangci-lint runs `default: all` with a curated disable list.
- **`web/dist/` is committed and embedded.** A UI change isn't shipped until
  it's rebuilt in the same commit.
- **Go JSON tags are the frontend's contract** with `web/src/lib/types.ts`, and
  nothing validates the two sides. Change both together.
- **CI job names are required status checks matched by exact string.**
  Renaming one silently blocks every PR — see [`.github/`](.github/CLAUDE.md).

## Build, test, lint

Use the Makefile; CI calls the same targets, so the two cannot drift.

| Target | What it does |
|---|---|
| `make build` | `npm run build` → `web/dist/`, then compile `./triage` with it embedded. |
| `make ci` | Everything CI gates on: `ci-go` + `web-ci` + `actions-lint`. |
| `make ci-go` | fmt, `go fix`, vet, golangci-lint, `test -race`, coverage floor. |
| `make web-ci` | eslint, vitest + coverage floor, vite build. |
| `make actions-lint` | actionlint + zizmor over the workflows. |
| `make vuln` | pinned govulncheck. |
| `make hooks` | install the path-scoped pre-commit hook. |

```sh
go run ./cmd/triage -no-open   # API on :7333
cd web && npm run dev          # UI on :5173, proxies /api → :7333
```

Coverage floors are **scoped, not global**: 70% on `internal/config` +
`internal/store`, and 90% on the pure `web/src/lib` modules. Whole-tree floors
would just be diluted.

## Domain vocabulary

- **Card** — one issue presented for a decision. The deck streams in batches
  of 25 and reorders skipped issues to the back (`skip_count ASC, RANDOM()`).
- **Macro** — a named, key-bound sequence of ops with an outcome. Label and
  state references resolve **by name, per issue team**, so one macro works
  across every team.
- **Op** — one field mutation (`store.MacroStep`). Ad-hoc quick edits and
  macro steps are the same type on purpose.
- **Index filter** — the raw Linear `IssueFilter` deciding what gets synced at
  all. Changing it triggers a reindex.
- **View filter** — a local sqlite `WHERE` over already-indexed rows. Instant.
- **Fast vs. deep enrichment** — one `claude -p` call vs. a fanout of
  read-only scouts plus a synthesis pass.
- **Verdict** — the closed set every enrichment returns: `actionable`,
  `likely_obsolete`, `possibly_done`, `needs_info`, `duplicate_suspect`.
- **Skip / snooze** — local-only. They never touch Linear.

## Keeping these files current

**A stale map is worse than no map.** These CLAUDE.md files are indexes; the
code is the source of truth. When a PR changes the tree, update the affected
file **in the same PR**.

| You change… | Update… |
|---|---|
| add / remove / rename a directory | this index |
| add, rename, or delete a file in a documented directory | that directory's layout table |
| a Go JSON tag or wire type | `internal/*` doc **and** `web/src/lib/types.ts` |
| an API route | `internal/server` route table, `web/src/lib/api.ts`, both docs |
| a keyboard shortcut | `pages/Triage.tsx`, `HelpOverlay.tsx`, `README.md` |
| the report/verdict schema | `internal/deep`, `internal/ai`, `reportcomment.go`, `report-format.ts` |
| a CI job name | the `Main` ruleset's required checks (same PR, or not at all) |

Keep entries terse and edge-focused: purpose, key files, the invariant that
breaks if you get it wrong. Never restate the README — link to it. Don't
enumerate every file in a high-churn directory; describe the pattern. **If a
CLAUDE.md and the tree disagree, the tree wins** — fix the doc. Add a new
directory-level CLAUDE.md once a directory passes ~3 files or starts
accumulating conventions that aren't obvious from the code.
