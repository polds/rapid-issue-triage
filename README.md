# Rapid Issue Triage

A local-only, single-binary, keyboard-first triaging tool for Linear backlogs.
Think *Tinder for backlog triage*: one issue at a time as a card, one keystroke
per decision, with user-defined macros, AI enrichment via Claude Code, and a
gamified report page.

- **Go binary with the web UI embedded** — no services, no deploys, runs on
  `127.0.0.1` only.
- **sqlite index** — issues sync in the background; the UI always serves
  instantly from the local index and shows a stale/fresh indicator.
- **Skip tracking** — skipped issues sink to the back of the queue.
- **Macros** — one key applies a whole sequence ("Accept → label
  `infra:triaged` + move to project *Reliability*"). Labels/statuses are
  resolved *by name per team*, so one macro works across teams.
- **AI enrichment** — shells out to the `claude` CLI (no API key) for a
  summary + relevancy verdict (actionable / likely obsolete / possibly done /
  needs info / duplicate suspect). Deep runs are pooled: two run at once
  (`ai.max_concurrent`) and the rest wait their turn, showing their place in
  line on the card and in the notification bell while you keep triaging.
- **Reports** — daily throughput, outcome breakdown, streaks, speed stats, and
  what AI enrichment has spent: total tokens and estimated cost, broken down by
  responsibility (the fast enricher, each deep-run scout, the synthesis pass).
  Counts are the `claude` CLI's own accounting, not an estimate, and are
  recorded from the first enrichment run after upgrading.

## Setup

```sh
make build          # builds web UI (npm) and the `triage` binary
export LINEAR_API_KEY=lin_api_...   # Linear → Settings → Security & access → API keys
./triage            # opens http://127.0.0.1:7333
```

Datadog, GitHub, and Linear keys can also be pasted in **Settings** (stored locally, never sent anywhere except the matching API). If `claude` isn't on your PATH, Settings → Advanced lets you point at the binary.

First run kicks off a full sync of metadata plus every issue matching the
configured filter (default: workflow state type `triage`). The queue fills as
the sync streams in.

### Docker

Every release publishes a multi-platform image (linux/amd64, linux/arm64) to
GHCR, tagged with the version, the `MAJOR.MINOR` line, and `latest`:

```sh
docker run --rm \
  -p 127.0.0.1:7333:7333 \
  -v rapid-triage:/data \
  -e LINEAR_API_KEY=lin_api_... \
  ghcr.io/polds/rapid-issue-triage:latest
```

- **Publish it to `127.0.0.1` only.** The container listens on `0.0.0.0:7333`
  because loopback inside a network namespace is reachable from nothing; the
  `-p 127.0.0.1:7333:7333` above is what keeps the *host* exposure the same as
  running the binary. `-p 7333:7333` would put an API that spawns subprocesses
  on every interface. See [SECURITY.md](SECURITY.md).
- **`/data` is the state directory** — it is `$HOME` inside the image, so the
  sqlite index lands in `/data/.rapid-triage/` and survives `docker rm`. The
  image runs as uid 65532; a bind mount needs to be writable by it, a named
  volume just works.
- **AI enrichment is off in the container** unless you mount a `claude` binary
  into it: the image is distroless and ships only `triage`.
- The image carries the standard OCI labels and annotations, so
  `docker buildx imagetools inspect ghcr.io/polds/rapid-issue-triage:latest`
  reports the exact version, commit, and base image it was built from.

## Configuration

Copy `rapid-triage.example.yaml` to `./rapid-triage.yaml` or
`~/.config/rapid-triage/config.yaml`. The `filter` block is a raw
[Linear IssueFilter](https://developers.linear.app/docs/graphql/filtering)
passed through verbatim, so any filter Linear supports defines your queue.

Flags: `-config path`, `-addr host:port`, `-no-open`, `-version`.

The running version is shown beside the wordmark in the top bar and under
**Settings → About**. Once a day the app asks GitHub whether a newer release
exists and, if so, the top bar links to it. That check is the only outbound
request the app makes that is not to Linear or to your local `claude` binary —
one unauthenticated `GET` of the public releases endpoint, carrying nothing but
the version in its User-Agent. Turn it off with:

```yaml
update_check:
  enabled: false
```

## Keyboard map

| Key | Action |
|---|---|
| `←` / `→` | previous / next card |
| `S` / `Z` | skip / snooze 7 days |
| `1–9` | apply macro |
| `L` `E` `C` `P` `A` `X` | labels / estimate / cycle / project / assignee / status pickers |
| `Space` | expand description + comments |
| `I` | enrich with AI |
| `O` | open in Linear |
| `U` | undo last action |
| `?` | help overlay |

## How actions map to Linear

Every action is a single `issueUpdate` GraphQL mutation. Undo restores the
exact pre-action field values (labels, state, estimate, project, cycle,
assignee) both in Linear and locally. Skips and snoozes are local-only —
they never touch Linear.

## Development

```sh
go run ./cmd/triage -no-open   # API on :7333
cd web && npm run dev          # UI on :5173, proxies /api to :7333
```

The UI design was generated with Lovable ("Triage Dash") and ported to a
dependency-light Vite + React + Tailwind v4 SPA embedded via `go:embed`.

## CI

Every push and pull request to `main` runs `.github/workflows/ci.yml`:

- Go `gofmt`, `go fix`, `vet`, golangci-lint v2.13, `go test -race`
- Coverage floor of 70% on `internal/config` and `internal/store`
- Web ESLint, Vitest (90% floor on the pure `src/lib` modules), `tsc`, Vite build
- Compile the embedded binary on Linux, macOS, and Windows
- `actionlint` + `zizmor` over the workflows themselves
- `govulncheck`, `npm audit --audit-level=high`, gitleaks, and a
  dependency review that blocks PRs adding a high-severity advisory
- **SAST:** semgrep over Go *and* the TypeScript/React UI (`p/golang`,
  `p/gosec`, `p/typescript`, `p/react`, `p/dockerfile`, `p/secrets`), findings
  uploaded to the Security tab as SARIF
- **License scan:** every Go module compiled into the binary and every npm
  package bundled into `web/dist` is held to a permissive allow-list. Dev-only
  npm packages are executed rather than redistributed, so they clear a
  narrower deny-list instead (GPL, AGPL, source-available, non-commercial).
  Dependency review applies the strict list to what a PR adds at runtime scope
- **Code quality:** `go mod tidy -diff` and whole-program `deadcode`, on top
  of golangci-lint (`gocyclo`, `dupl`, `unused`, `revive`) for Go and
  eslint + `eslint-plugin-sonarjs` for the UI

> **Job names are load-bearing.** The `Main` ruleset lists CI job names as
> required status checks, and GitHub matches them by exact string. Renaming a
> job whose name is required makes that check sit at "Expected — waiting for
> status to be reported" forever, silently blocking every PR even when all of
> CI is green. Adding a matrix to a job renames it too: it then reports once
> per matrix leg, as `Job name (leg)`. Change a job name and the ruleset in the
> same PR, or not at all.

`.github/workflows/codeql.yml` runs CodeQL (`security-extended`) over both Go
and the TypeScript UI on every PR and weekly.
`.github/workflows/scorecard.yml` reports the repository's OpenSSF Scorecard.

Every action is pinned to a commit SHA, jobs declare least-privilege
`permissions` and a timeout, and checkouts use `persist-credentials: false`.
The release job additionally disables toolchain caching so a poisoned cache
cannot reach a signed, attested artifact. Deliberate zizmor exceptions live in
`.github/zizmor.yml`.

Dependabot opens weekly PRs for Go modules, `web/` npm, and Actions.

Local equivalent: `make ci` — `ci-go` (fmt, fix, vet, lint, `test -race`, coverage),
`web-ci` (eslint, vitest, build, `web/dist` freshness), `actions-lint`
(actionlint, zizmor), `quality` (`go mod tidy -diff`, `deadcode`), and
`ci-security` (`vuln`, `sast`, `licenses`). `make licenses-report` prints every
dependency license rather than only the ones that fail.

Install the git hook with `make hooks`. It runs only the gates a commit
actually touches, so a web-only change does not pay for the Go race suite:

| Staged paths | Runs |
|---|---|
| `*.go`, `go.mod`/`go.sum`, `Makefile`, `.golangci.yml` | `make ci-go` |
| `*.go`, `go.mod`/`go.sum`, `Makefile` | `make quality` |
| `go.mod`/`go.sum`, `web/package*.json`, `Makefile`, the license script | `make licenses` |
| `web/**` (excluding `web/dist/`) | `make web-ci` |
| `.github/workflows/**`, `.github/zizmor.yml` | `make actions-lint` |

`make sast` is deliberately *not* in the hook: semgrep fetches its rulesets
from the registry, so it needs network and roughly 40s — per-commit is how you
teach people to reach for `--no-verify`. It runs in `make ci`, under
`PRE_COMMIT_ALL=1`, and on every push.

`PRE_COMMIT_ALL=1 git commit` forces the full `make ci`; `--no-verify` skips it.

### The committed `web/dist`

`webui.go` embeds `web/dist` with `go:embed`, so the built bundle is tracked:
without it `go install github.com/polds/rapid-issue-triage/cmd/triage@latest`
does not compile. That means the UI a plain checkout serves is whatever was
committed, not whatever `web/src` currently says, and CI builds into an
artifact it never compares against the committed copy.

`make web-dist-check` (part of `web-ci`, and a step in the CI web job) rebuilds
and fails when the two disagree. When it does, run `make web-build` and stage
`web/dist` alongside your source change - the check ignores an already-staged
rebuild, so it is satisfied in the same commit.

`make lint` runs the same golangci-lint version CI pins (`v2.13.2`). Requires Go 1.27 (`asdf` via `.tool-versions`, or `go.mod`).
`make vuln` runs the pinned govulncheck. zizmor and semgrep are optional
locally (`pipx install zizmor==1.29.0`, `pipx install semgrep==1.175.0`) and
required in CI, so a missing binary can never silently skip the audit.

## Releasing

Tag a semver and push. GoReleaser builds CGO-free, reproducible (`-trimpath`, `-buildid=`, `SOURCE_DATE_EPOCH`) binaries for:

- macOS universal (amd64 + arm64)
- Linux amd64, arm64, 386, armv7, riscv64, ppc64le, s390x, loong64 (plus deb/rpm/apk)
- Windows amd64, arm64, 386
- FreeBSD / OpenBSD amd64+arm64, NetBSD amd64

Each archive gets an SPDX SBOM (Syft). The workflow attests SLSA build provenance (`gh attestation verify --owner polds <file>`). Checksums are SHA-256.

```sh
git tag v0.1.0
git push upstream v0.1.0
```

The same run publishes the container image described under
[Docker](#docker) to `ghcr.io/polds/rapid-issue-triage`, built from those same
binaries rather than from source, with a BuildKit SBOM attestation and the same
build provenance:

```sh
gh attestation verify oci://ghcr.io/polds/rapid-issue-triage:0.1.1 --owner polds
```

`workflow_dispatch` on the Release workflow takes a `tag` input and a
`create_tag` checkbox:

- **Empty `tag`** — snapshot dry run. Builds and packages everything but
  publishes nothing; the archives, packages, SBOMs, and checksums are uploaded as
  a `snapshot-dist` workflow artifact so you can inspect them. The container
  image is built too — per-platform and local-only, since buildx cannot assemble
  a multi-platform manifest without pushing it — so a broken `Dockerfile` fails
  the dry run rather than a real release.
- **`tag` set, `create_tag` unchecked** — publishes that existing tag's GitHub
  Release from a manual run, exactly as a tag push would.
- **`tag` set, `create_tag` checked** — creates the tag at the dispatched ref,
  then releases it in the same run. Use this to cut a release without a local
  git checkout. The run fails if the tag already exists.

Because the tag is minted and released inside one job, nothing depends on the
tag push re-triggering the workflow — a `GITHUB_TOKEN` push deliberately does
not do that.

### Immutable releases

This repo has GitHub's [immutable releases][immutable] enabled: once a release
is published, its assets and tag are frozen, and the tag name can never be
reused. The workflow is built for that — GoReleaser creates the release as a
draft, uploads every artifact, and only then publishes it.

Two consequences worth knowing:

- **Never create the release by hand in the Releases UI.** That publishes it
  immediately, so GoReleaser has nowhere to attach the archives and the run
  fails. The tag name is then burnt and you have to bump the version.
- A run that dies mid-upload leaves a draft behind. `replace_existing_draft`
  clears it, so re-running the same tag works.

The container image is not covered by that immutability: a re-run of the same
tag overwrites the image tags it pushed. The digest of the previous push stays
resolvable, and the release's own attestations pin digests, not tags.

The GHCR package is created private on its first push. Make it public once, in
the package settings, if the image is meant to be pullable anonymously — the
`org.opencontainers.image.source` label is what links the package to this
repository so those settings are reachable from it.

[immutable]: https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
