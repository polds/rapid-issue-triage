---
name: run-rapid-issue-triage
description: Build, run, and drive the rapid-issue-triage app (Go server + embedded React SPA on 127.0.0.1:7333). Use when asked to start or run triage, take a screenshot of its UI, click through the triage deck, exercise a keyboard shortcut, verify a change in the real app, or run its tests.
---

Rapid Triage is one Go binary with the React SPA baked in via `go:embed`; it
serves `127.0.0.1:7333` and reads everything from a local sqlite index. Drive it
with **`.claude/skills/run-rapid-issue-triage/driver.mjs`** (Playwright), which
launches the binary, seeds an offline workspace, and drives the page.

The one thing to know before anything else: **the app refuses to start without
`LINEAR_API_KEY`, and a real one is not available here.** A fake key gets past
the startup check; the sync then fails auth and the UI degrades to a red
"Sync error · retry" badge while still serving the local index. That degraded
mode is the designed behaviour, and it is the mode you will always be in. The
driver handles the fake key and the seeding for you.

All paths are relative to the repo root.

## Prerequisites

Nothing to install — this container already has Go 1.27, Node 22, and a global
`playwright@1.56.1` with Chromium at `/opt/pw-browsers`. No `apt-get` needed, no
`xvfb` (Chromium runs headless), and **do not run `playwright install`**.

Playwright is installed globally, not in `web/node_modules`, so a bare
`import 'playwright'` does not resolve from this repo. The driver imports it by
absolute path; override with `PLAYWRIGHT_ENTRY` if the image changes.

## Build

`make build` compiles the SPA into `web/dist/` and then embeds it. Takes ~40s
cold. **The driver does not build** — it expects `./triage` to exist.

```bash
make build          # npm install + vite build + go build -o triage
```

`web/dist/` is committed and embedded, so a frontend change is invisible to the
binary until you re-run `make build`.

**`make build` and `make web-ci` install web deps differently.** `make build`'s
`ui` target runs `npm install`; `web-ci`'s `web-build` → `web-deps` runs
`npm ci`. When the lockfile and `npm install`'s resolution disagree, Vite emits
a bundle with a different content hash and `make build` leaves
`web/dist/index.html` plus a renamed `assets/index-*.js` in your diff on an
otherwise untouched tree. Observed once this session on an older lockfile; it
does not reproduce on the current one, so treat it as a thing to check for, not
a thing that always happens.

`make web-dist-check` (part of `web-ci`, and a CI gate) fails when the committed
bundle doesn't match a fresh build. It inspects only the **worktree** column of
`git status`, so a rebuild you have already `git add`ed passes. If you changed
the UI, stage the rebuild — that is what the gate wants. If you changed nothing
and it still drifted, revert with `git checkout -- web/dist/` and delete the
stray asset.

## Run (agent path)

```bash
node .claude/skills/run-rapid-issue-triage/driver.mjs smoke
```

That is the whole loop: start the server, seed a fixture workspace, then drive
the real page — load the deck, expand a description with `Space`, skip with `S`,
open the help overlay with `?`, and visit all four routes. It asserts each step,
writes numbered screenshots, and exits non-zero on failure.

Everything lands in `.run-sandbox/` (gitignored): `triage.db`, `server.log`,
`rapid-triage.yaml`, and `shots/*.png`. **Your real `~/.rapid-triage/triage.db`
is never touched.**

Verified output:

```
[driver] ✓ deck loads — first card ENG-355
[driver] ✓ failed sync degrades, does not break the UI — state=error issueCount=6
[driver] ✓ sqlite-backed endpoints work; Linear passthroughs 502 — 7 local 200, 2 live 502
[driver] ✓ space expands the description — expanded
[driver] ✓ skip (S) advances the deck — ENG-355 → ENG-388
[driver] ✓ ? opens the help overlay — overlay shown
[driver] ✓ reports route renders — report page
[driver] ✓ settings route renders — settings page
[driver] ✓ macros route renders — macros page
```

### Other subcommands

| Command | Does |
|---|---|
| `driver.mjs start` | Launch the server only, leave it running. |
| `driver.mjs seed` | Re-seed the fixture (server must have run once — Go owns the DDL). |
| `driver.mjs smoke` | Start + seed + full scripted flow + screenshots. |
| `driver.mjs repl` | Interactive stdin loop, for poking at something specific. |
| `driver.mjs stop` | Kill the server (pidfile, plus any orphan running `./triage`). |

Env: `RT_PORT` (default 7333), `RT_SANDBOX` (default `.run-sandbox`).

### Interactive driving (repl under tmux)

Use this when the scripted flow doesn't reach what you need. Every command
prints `[ready]` when it finishes, so you can poll for that instead of sleeping.

```bash
tmux new-session -d -s rt -x 200 -y 50 \
  'node .claude/skills/run-rapid-issue-triage/driver.mjs repl 2>&1'
until tmux capture-pane -pt rt -S -50 | grep -q 'repl ready'; do :; done

tmux send-keys -t rt 'eval document.body.innerText.match(/ENG-\d+/)[0]' Enter
tmux send-keys -t rt 'key z' Enter          # snooze the current card
tmux send-keys -t rt 'shot my-check' Enter
tmux capture-pane -pt rt -S -50 -p | grep -v '^$' | tail -10
```

Commands: `goto <hash>` · `shot <name>` · `key <K>` · `click <sel>` · `text` ·
`eval <js>` · `seed` · `errors` · `quit`.

`key` blurs the focused element first — the app binds shortcuts on `window`, so
a keystroke sent while focus sits in an input goes into the input instead.

## Run (human path)

```bash
LINEAR_API_KEY=lin_api_... ./triage      # opens a browser at 127.0.0.1:7333
go run ./cmd/triage -no-open             # API only
cd web && npm run dev                    # UI on :5173, proxies /api to :7333
```

Useless headless: `-no-open` matters here, since `xdg-open` has nothing to open.

## Test

```bash
make test-race                 # go test -race  → ok (config, server, store)
npm --prefix web run coverage  # 33 tests, 5 files, 100% on src/lib
make web-dist-check            # → "web/dist matches a fresh build"
make quality                   # go mod tidy -diff + deadcode → "no unreachable functions"
```

All four pass here. `make ci` is the full gate — `ci-go`, `web-ci`,
`actions-lint`, `quality`, and `ci-security` (govulncheck, semgrep, licenses) —
and is slow; the pieces above are the fast ones. Its `actions-lint` step needs
`shellcheck`, which is **not** installed here, so actionlint silently skips
every `run:` block locally and a clean local run proves less than it looks.
`zizmor` is on PATH.

## Gotchas

- **A fresh database renders "Inbox zero for this view", not an error.** The
  sync cannot succeed without a real key, so nothing ever populates. Seeding is
  not a convenience — without it there is no UI to look at. `driver.mjs smoke`
  seeds automatically; `driver.mjs start` alone does not.
- **The fixture survives the failing sync on purpose.** `syncOnce` calls
  `fetchWorkspace` first, which fails auth and returns before `PruneStale` can
  delete rows with a stale `sync_gen`. If a real key ever enters the picture,
  the first successful sync will wipe the fixture.
- **The fixture carries one Linear label group.** `Area` (a group) with
  children `ci-cd` and `infrastructure`; `iss-1`/ENG-412 already has `ci-cd`,
  and macro **4** ("Accept → Infra Backlog") adds `infrastructure`. That is the
  clash the replace prompt exists for, and it is reachable offline because the
  pre-flight runs before the Linear call: navigate to ENG-412 with
  `key ArrowRight` (deck order is random) and press `4`. The server side is
  `POST /api/issues/iss-1/macro/4`, which answers `409 label_group_conflict`;
  add `{"replaceGroupLabels":true}` and it gets as far as the usual 502.
- **Skip and snooze work offline; macros and quick edits do not.** `S`/`Z` are
  local sqlite writes. Everything else — macros, label/state/estimate pickers,
  undo — goes through `resolveOps` → `applyOps` → a Linear `issueUpdate`, so it
  returns `502 {"error":"linear: Authentication required, not authenticated"}`.
  Pressing `1` and seeing nothing happen is expected, not a bug you introduced.
- **Two routes are live Linear passthroughs and always 502 offline:**
  `/api/views` and `/api/issues/{id}/context`. Everything else serves from
  sqlite. The smoke test asserts exactly this split, so if a "local" route
  starts 502-ing, something moved off the local index.
- **Deck order is `skip_count ASC, RANDOM()`** — the first card differs on every
  run. Never assert on a specific identifier; match `/ENG-\d+/` and compare
  before/after.
- **The route is `#/reports`, not `#/report`.** `pageFromHash` silently falls
  back to the triage page for anything it doesn't recognise, so a typo'd route
  looks like a passing test that screenshotted the wrong screen.
- **AI enrichment actually works here.** `claude` is at `/opt/node22/bin/claude`
  and authenticated, so `I` / `POST /api/issues/{id}/enrich` returns a real
  summary and verdict in ~20s. The card will not show it until the deck is
  refetched — enrichments are embedded in the `/api/queue` payload, so reload
  the page after enriching out-of-band.
- **`sqlite_sequence` is why macro ids drift.** `macros.id` is `AUTOINCREMENT`,
  so a plain `DELETE FROM macros` leaves the counter alone and a re-seed hands
  out ids 10, 11, 12. The fixture resets the sequence so `POST
  /api/issues/{id}/macro/1` keeps meaning the first macro.
- **Never `pkill -f triage`.** `-f` matches full command lines, including the
  shell command that invoked it — it kills its own caller and the tool call dies
  with exit 144 and no output. `driver.mjs stop` kills by pid and by
  `/proc/*/exe` instead.
- **`tmux capture-pane -pt rt` without `-S` returns mostly blank lines**, so
  piping it to `tail` shows nothing and looks like the REPL hung. Use
  `-S -50 -p`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `error: LINEAR_API_KEY is not set` | You launched `./triage` directly. Use the driver, or export any non-empty value. |
| `triage not built — run make build first` | `make build`. |
| `unable to open database file` / `no such table` | The sandbox was wiped while a server was adopted. `driver.mjs stop && rm -rf .run-sandbox && driver.mjs smoke`. |
| `something else is already serving ... against another database` | Another `triage` owns 7333. `driver.mjs stop`, or `RT_PORT=7334 driver.mjs smoke`. |
| Bash tool exits 144 with no output | You ran `pkill -f` with a pattern matching your own command. See Gotchas. |
| `waitForSelector` resolved to 6 elements, timed out | Loose `text=` selector matching card content. Anchor on the heading: `h2:text-is("Keyboard shortcuts")`. |
| `sync: linear: Authentication required` in `server.log` | Expected on every tick. The config sets `interval: 24h` to keep it to one line. |
