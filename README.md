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
  needs info / duplicate suspect).
- **Reports** — daily throughput, outcome breakdown, streaks, speed stats.

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

## Configuration

Copy `rapid-triage.example.yaml` to `./rapid-triage.yaml` or
`~/.config/rapid-triage/config.yaml`. The `filter` block is a raw
[Linear IssueFilter](https://developers.linear.app/docs/graphql/filtering)
passed through verbatim, so any filter Linear supports defines your queue.

Flags: `-config path`, `-addr host:port`, `-no-open`, `-version`.

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

- Go `gofmt`, `go fix`, `vet`, golangci-lint v2.13, `go test ./...`
- Coverage floor of 70% on `internal/config` and `internal/store`
- Web `npm ci` + `tsc` + Vite build
- Compile the embedded binary
- `govulncheck`, `npm audit --audit-level=high`, and gitleaks

Dependabot opens weekly PRs for Go modules, `web/` npm, and Actions.

Local equivalent: `make ci` (or `make pre-commit`). Install the git hook with `make hooks` so those checks run before each commit.
`make lint` runs the same golangci-lint version CI pins (`v2.13.2`). Requires Go 1.27 (`asdf` via `.tool-versions`, or `go.mod`).

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

`workflow_dispatch` on the Release workflow takes a `tag` input and a
`create_tag` checkbox:

- **Empty `tag`** — snapshot dry run. Builds and packages everything but
  publishes nothing; the archives, packages, SBOMs, and checksums are uploaded as
  a `snapshot-dist` workflow artifact so you can inspect them.
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

[immutable]: https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
