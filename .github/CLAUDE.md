# .github/ — CI, security scanning, releases

Six workflows plus Dependabot. Local equivalents live in the `Makefile`, and
CI calls those `make` targets rather than spelling out commands twice — so
`make ci` and CI cannot drift. Keep it that way. The pinned tool versions are
part of that rule: they live in the `Makefile` and CI resolves them with
`make -s print-<VAR>`, never as a second literal in a workflow.

| File | What it does | Local equivalent |
|---|---|---|
| `workflows/ci.yml` | 7 jobs: Go, golangci-lint, workflow lint, web, 3-OS binary compile, security, dependency review. | `make ci` |
| `workflows/codeql.yml` | CodeQL `security-extended` over Go + TypeScript; PR and weekly. | — |
| `workflows/release.yml` | GoReleaser: multi-OS archives, SPDX SBOM, SLSA provenance, optional tag minting. | `goreleaser check` |
| `workflows/scorecard.yml` | OpenSSF Scorecard → SARIF in the Security tab. | — |
| `workflows/dependabot-auto-merge.yml` | Enables auto-merge on patch/minor Dependabot PRs. Not a gate. | — |
| `dependabot.yml` | Weekly gomod / npm(`/web`) / actions PRs. | — |
| `zizmor.yml` | Reviewed audit exceptions. Every entry is deliberate; the default is to fix a finding, not list it. | — |

## ⚠️ Job names are load-bearing

The repo's **`Main` branch ruleset lists all 11 CI job names as required
status checks, and GitHub matches them by exact string.** Renaming a job whose
name is required leaves that check at "Expected — waiting for status to be
reported" forever, silently blocking every PR while all of CI is green. This
has already happened once (`Web typecheck and build` → `Web lint, test,
build`).

Adding a matrix renames a job too — it then reports once per leg as
`Job name (leg)`.

**Read the ruleset before touching a `name:`**, and change the job and the
ruleset in the same PR, or not at all:
`GET /repos/OWNER/REPO/rulesets/<id>`.

## Hardening conventions (don't regress these)

- **Every action is pinned to a commit SHA.** A tag is not a pin.
- **Least-privilege `permissions:` and a `timeout-minutes:` on every job.**
- **`persist-credentials: false` on every checkout.** The release job pushes
  its tag with an explicit `x-access-token` URL instead, so the job token
  never sits in `.git/config` while GoReleaser runs.
- **The release job disables toolchain caching** (setup-go *and* setup-node).
  A cache entry poisoned from any branch would otherwise be reachable from
  signed, attested artifacts. Releases are rare; a cold build is the trade.
- **Optional tools gate on the `CI` env var**: warn on a developer machine,
  hard-fail on a runner. A check that silently no-ops when its binary is
  missing is worse than no check. This is why `make actions-lint` fails in CI
  without `shellcheck` or `zizmor`.
- Rejected on purpose: StepSecurity `harden-runner` — a broad third-party
  action proxying all runner egress is itself supply-chain surface, and every
  action here is already SHA-pinned.

## Release: how it actually publishes

Triggers: a `v*.*.*` tag push, or `workflow_dispatch` with two inputs.

| `tag` | `create_tag` | Result |
|---|---|---|
| empty | — | **Snapshot dry run.** Builds and packages everything, publishes nothing, uploads `snapshot-dist` for inspection. |
| set | unchecked | Publishes that **existing** tag's release. |
| set | checked | Mints the tag at the dispatched ref, then releases it in the same run. Fails if the tag exists. |

Because the tag is minted and released inside one job, nothing depends on the
tag push re-triggering the workflow — a `GITHUB_TOKEN` push deliberately does
not do that, and that absence is what prevents a double release.

### Release traps (each of these has cost a version number)

- **A green run is not a published release.** `--snapshot` never touches the
  Releases API. Check the run's resolved GoReleaser version and whether the
  attestation step was skipped — `8aa5c68-snapshot / tag: v0.0.0` means it
  published nothing.
- **Publishing a tag uses *that tag's tree*.** GoReleaser reads
  `.goreleaser.yaml` from the tag; only the workflow YAML comes from the
  dispatched ref. A tag cut before a config fix stays broken forever — bump
  the version. (This is why `v0.1.0` was abandoned for `v0.1.1`.)
- **Immutable releases are on.** Never create the release by hand in the
  Releases UI: it publishes instantly, GoReleaser then has nowhere to attach
  archives, the run fails, and **the tag name is burnt permanently**. The
  workflow's draft-then-publish order is exactly what immutability requires.
- **The `Release Tags` ruleset (all tags, no bypass actors) blocks deletion,
  tag moves, and force pushes.** Never add the `creation` rule without first
  registering a bypass actor — `GITHUB_TOKEN` holds none, so restricting
  creation makes the `create_tag` path 403. `required_signatures` stays off
  for the same reason (the runner's `git tag -a` is unsigned).
- **No `tag_name_pattern`** (or any metadata-restriction rule) — this is a
  user-owned repo and those 422. Semver enforcement lives in `release.yml`'s
  own regex guard plus the `v*.*.*` trigger glob.
- Don't put `dist/*.spdx.json` in `release.extra_files`: SBOMs are already
  first-class GoReleaser artifacts, and the glob double-queues them into a
  `422 already_exists`. `checksum.extra_files` is the right home.

## Dependabot commit scopes

The scope names the **repo area, not `deps`**: `build(backend)` (gomod),
`build(frontend)` / `chore(frontend)` (npm devDeps), `ci(actions)`.

Never combine a scoped prefix with `include: "scope"` — Dependabot appends its
own `(deps)`, producing `build(backend)(deps): …`, which is not a valid
Conventional Commit. Nothing enforces this in CI, so this config is the only
specification.

## Dependabot auto-merge

`workflows/dependabot-auto-merge.yml` calls `gh pr merge --auto` on Dependabot
PRs. It **bypasses nothing**: `--auto` queues behind the same 11 required
checks, and the `Main` ruleset requires 0 approving reviews, so the only thing
removed is a human clicking merge on an already-green PR.

Two things always wait for a person:

- **Major bumps.** CI catches the ones that break the build, but a major that
  happens to compile can still change behaviour.
- **Actions no pull request executes** — `actions/attest`,
  `anchore/sbom-action`, `goreleaser/goreleaser-action`, `ossf/scorecard-action`.
  They appear only in `release.yml` / `scorecard.yml`; CI lints those files but
  never runs the action, so a bump is unvalidated until a release fires — and a
  failed release burns a tag name. Every other action is also used by `ci.yml`
  or `codeql.yml`, so the PR's own run is the proof. **Keep that list in step
  with where actions are actually used.**

It must use `pull_request_target`: a `pull_request` run from Dependabot gets a
read-only token that cannot enable auto-merge. That trigger is safe here only
because the workflow has **no `actions/checkout`** — never add one, or the
zizmor exception in `zizmor.yml` stops being true.

Its job is deliberately **not** a required status check. It is an automation,
not a gate, and it is skipped on human PRs.

## Local gates before pushing

```sh
make ci             # everything CI gates on
make actions-lint   # actionlint + zizmor over these workflows
make hooks          # install the path-scoped pre-commit hook
```

The hook runs only the gates a commit touches (Go / web / workflows), so a
one-line web tweak doesn't pay for the Go race suite — that is what keeps
people off `--no-verify`. `PRE_COMMIT_ALL=1` forces the full run.

- **A green local `actionlint` proves less than it looks.** It shells out to
  `shellcheck` for `run:` blocks only when `shellcheck` is on PATH, and
  silently skips them otherwise while still exiting 0.
- **Always run `zizmor --no-online-audits`** without a GitHub token.
  Unauthenticated it doesn't degrade — it panics with a 401 and audits nothing.
- A tool failing locally does not mean CI is red: `make lint`/`make vuln` can
  fail on a toolchain mismatch that a `setup-go` runner doesn't have. Check
  the actual run conclusions.

## Maintenance

Adding a job → the table above **and** the `Main` ruleset's required checks,
or the gate is unenforced. Changing a `make` target CI calls → verify both
sides still line up.

Bumping a pinned tool (`GOLANGCI_LINT_VERSION`, `GOVULNCHECK_VERSION`,
`ACTIONLINT_VERSION`, `ZIZMOR_VERSION`) → edit the `Makefile` only; CI reads it
back through `make -s print-<VAR>`. Dependabot does **not** track these — it
bumps `uses:` refs, not a version a make target hands to `go run` or `pip`, so
they are watched by hand. Do not try to fix that with one shared `tools/go.mod`:
MVS unifies every tool's graph, and golangci-lint raising `go.yaml.in/yaml/v4`
past what actionlint compiles against breaks `make actions-lint`. One module
per tool, or leave it.
