# .github/ — CI, security scanning, releases

Five workflows plus Dependabot. Local equivalents live in the `Makefile`, and
CI calls those `make` targets rather than spelling out commands twice — so
`make ci` and CI cannot drift. Keep it that way. The pinned tool versions are
part of that rule: they live in the `Makefile` and CI resolves them with
`make -s print-<VAR>`, never as a second literal in a workflow.

| File | What it does | Local equivalent |
|---|---|---|
| `workflows/ci.yml` | 10 jobs: Go, golangci-lint, workflow lint, web, 3-OS binary compile, security, SAST, license scan, code quality, dependency review. | `make ci` |

The `Security` job carries five scanners, not one — govulncheck, OSV-Scanner,
Trivy, `npm audit`, gitleaks — because they answer five different questions
about the same supply chain. See the risk table below for which owns which.
| `workflows/codeql.yml` | CodeQL `security-extended` over Go + TypeScript; PR and weekly. | — |
| `workflows/release.yml` | GoReleaser: multi-OS archives, SPDX SBOM, SLSA provenance, the GHCR container image, optional tag minting. | `goreleaser check` |
| `workflows/scorecard.yml` | OpenSSF Scorecard → SARIF in the Security tab. | — |
| `workflows/dependabot-auto-merge.yml` | Enables auto-merge on patch/minor Dependabot PRs. Not a gate. | — |
| `dependabot.yml` | Weekly gomod / npm(`/web`) / actions / docker PRs. | — |
| `zizmor.yml` | Reviewed audit exceptions. Every entry is deliberate; the default is to fix a finding, not list it. | — |

## Which check owns which risk

Two scanners covering the same ground is not duplication here — different rule
authors miss different things — but knowing which one is *authoritative* for a
class of problem is what keeps a finding from being triaged twice.

| Risk | Gate | Where |
|---|---|---|
| Code-level vulnerabilities, Go | CodeQL (`security-extended`) + semgrep `p/golang`,`p/gosec` + golangci-lint's `gosec` | `codeql.yml`, `SAST`, `golangci-lint` |
| Code-level vulnerabilities, TS/React | CodeQL + semgrep `p/typescript`,`p/react` + the eslint security rules | `codeql.yml`, `SAST`, `Web` |
| Released image, Dockerfile as text | semgrep `p/dockerfile` over the root `Dockerfile` | `SAST` |
| Released image, base layer CVEs | `trivy image` over the digest on the `FROM` line | `Security` |
| Vulnerable dependency, Go | `govulncheck` (reachability-aware) | `Security` |
| Vulnerable dependency, npm | `npm audit --audit-level=high` | `Security` |
| Vulnerable dependency, either, unfiltered | `osv-scanner` over `go.mod` + `web/package-lock.json` | `Security` |
| Vulnerable dependency, newly added | `dependency-review-action` | `Dependency review` |
| Committed secret | gitleaks over full history + semgrep `p/secrets` | `Security`, `SAST` |
| Dependency license, redistributed | `go-licenses` + the npm policy script, allow-list over the whole graph | `License scan` |
| Dependency license, dev-only | the same script's second tier: GPL/AGPL/source-available/non-commercial deny-list | `License scan` |
| Dependency license, newly added | `dependency-review-action` deny-list | `Dependency review` |
| Complexity / duplication / dead code | golangci-lint (Go), eslint + sonarjs (TS), `deadcode` + `go mod tidy -diff` (whole program) | `golangci-lint`, `Web`, `Code quality` |

The **SAST** job uploads SARIF, so semgrep findings land in the Security tab
next to CodeQL's. Its upload step is `if: ${{ !cancelled() }}` on purpose — a
red job whose findings are invisible is the worst of both.

**Semgrep is pinned in the `Makefile` and installed from PyPI**, not run
through `semgrep/semgrep-action`: that action wants a Semgrep AppSec Platform
token and sends findings to a SaaS backend. This project keeps scanning local
for the same reason it binds to `127.0.0.1`.

GitHub's own **secret scanning with push protection** is a repository setting,
not a workflow, and is the layer that stops a secret *before* it is committed.
gitleaks is the in-CI backstop; neither replaces the other.

**OSV-Scanner is not redundant with govulncheck.** govulncheck filters by
reachability: it stays quiet about a vulnerable module no code path in *this*
build reaches. That is the right gate for "fix it now" and the wrong one for an
inventory — users compile this binary themselves, from a tree they can
configure differently, so "unreachable here" is a weaker claim than it looks.
OSV is also the only scanner that reads `go.mod` and `web/package-lock.json`
against one database, which is how an npm finding reaches the Security tab at
all: `npm audit` only prints to a console. A finding that is genuinely not
applicable belongs in an `osv-scanner.toml`, with a reason, not in a narrower
`--lockfile` list.

**Trivy scans the base image, not the released one.** The published container
is this binary on top of distroless and nothing else, and the binary's own
dependencies are already covered above — so the base *is* the uncovered half.
`make trivy` reads the target off the `Dockerfile`'s `FROM` line rather than
repeating the digest, the same discipline GoReleaser follows for `base.name` /
`base.digest`, so a Dependabot bump cannot leave a stale copy behind. Scanning
the base rather than a pulled `ghcr.io` tag is deliberate: it needs no
registry auth, works on a PR that has published nothing, and is deterministic.
Dependabot bumps the pin but cannot tell you whether the digest pinned *today*
has a CVE, and it can only bump to a fix that exists; this is the check that
answers both.

It reports twice on one warm database: everything into SARIF, so the Security
tab shows unfixed findings too, then a gate pass that ignores what has no fix
available. A Debian CVE with no patched version is not something a PR can act
on, and blocking every merge on it only teaches people to use `--no-verify`.

## The starter-workflow catalogue: what was declined, and why

GitHub's *Actions → New workflow → Security* catalogue is ~76 entries. Most are
irrelevant here on language grounds (Python, Ruby, Clojure, Elixir, .NET, PHP,
mobile) or target infrastructure this project does not have (Terraform,
Kubernetes, a hosted API to DAST). Of the rest:

| Declined | Why |
|---|---|
| **Snyk** (`snyk-security`, `snyk-container`, `snyk-infrastructure`) | Needs `SNYK_TOKEN` and uploads the dependency graph to a SaaS backend. Same objection that already rules out `semgrep/semgrep-action` here, and `govulncheck` + OSV + `npm audit` + dependency review cover the ground it would. |
| **SonarQube / SonarCloud** | Needs `SONAR_TOKEN` plus either SonarCloud or a self-hosted server; its quality gate would duplicate golangci-lint (`default: all`) and eslint + sonarjs, which already run locally with no account. |
| **Codacy, Checkmarx, Veracode, Fortify, Contrast, Black Duck / Synopsys, JFrog / Frogbot, Endor Labs, Prisma, Sysdig, Zscaler, Mayhem, NowSecure, Appknox, StackHawk, SOOS, Debricked, APIsec, DevSkim-adjacent commercial scanners** | All token-gated SaaS. A workflow whose scanner silently no-ops without a secret is worse than no check — and a fork PR never has the secret. |
| **Microsoft Defender for DevOps, OSSAR** | Azure DevOps / Windows-runner bound. |
| **ESLint (`eslint.yml`)** | The SARIF variant adds `@microsoft/eslint-formatter-sarif` — a new redistributable dependency for the license gate to judge — to surface findings from a linter that is *already a hard blocking gate* in the `Web` job. Security-tab alerts are valuable for scanners that only warn; they add nothing to a check that already fails the build. |
| **hadolint** | On a `COPY`-only distroless Dockerfile with no `RUN` layer, its `DL3xxx` rules have nothing to say, and semgrep's `p/dockerfile` already reads the file. |
| **Anchore / Syft** | The release already produces an SPDX SBOM via `anchore/sbom-action`. Grype would be a third opinion on the same package set Trivy and OSV cover. |
| **Trivy in filesystem/misconfig mode** | Overlaps OSV on dependencies and zizmor on workflow misconfiguration. Only the image mode was adopted. |

The two that survived — **OSV-Scanner** and **Trivy** — share the properties
every gate here needs: no account, no token, a pinned version, a SARIF report,
and a `make` target a contributor can run before pushing.

## ⚠️ Job names are load-bearing

The repo's **`Main` branch ruleset lists every CI job name as a required
status check, and GitHub matches them by exact string.** Renaming a job whose
name is required leaves that check at "Expected — waiting for status to be
reported" forever, silently blocking every PR while all of CI is green. This
has already happened once (`Web typecheck and build` → `Web lint, test,
build`).

Adding a matrix renames a job too — it then reports once per leg as
`Job name (leg)`.

The three checks added with the scanning work — **`SAST`**, **`License
scan`**, **`Code quality`** — take the required set from 11 to 14. Adding a
job to `ci.yml` does not make it required; until each is added to the ruleset
it runs and reports but cannot block a merge.

**Read the ruleset before touching a `name:`**, and change the job and the
ruleset in the same PR, or not at all:
`GET /repos/OWNER/REPO/rulesets/<id>`.

This is also why OSV-Scanner and Trivy were added as *steps of the existing
`Security` job* rather than as two new jobs. They belong to the risk that job
already owns, and a step needs no ruleset edit to be enforced — it is inside a
check that is already required. Reach for a new job only when a gate genuinely
does not fit an existing one, and expect to update the ruleset in the same PR.

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
  without `shellcheck` or `zizmor`, `make sast` without `semgrep`, and `make
  trivy` without `trivy`. The Go-toolchain scanners (`vuln`, `osv`,
  `licenses`, `quality`) need no such guard — `go run pkg@version` fetches
  them.
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

### The container image

`dockers_v2` in `.goreleaser.yaml` builds `ghcr.io/polds/rapid-issue-triage`
for linux/amd64 + linux/arm64 from the **binaries GoReleaser already built** —
the root `Dockerfile` only `COPY`s `$TARGETPLATFORM/triage`. Never give it a
builder stage: the image would then ship a different binary from the one the
archives and the provenance attest.

- **Images are built in the publish phase**, not the build phase — buildx
  cannot assemble a multi-platform manifest without pushing it. Anything that
  skips publishing skips the image; a snapshot run instead builds one
  `--load`ed image per platform, with a `-linux-amd64` style tag suffix, and
  pushes nothing.
- **`docker/setup-buildx-action` is not optional.** The runner's default
  builder uses the `docker` driver, which cannot build for another platform,
  and which also rejects `index:`-scoped annotations on a single-platform
  export ("index annotations not supported for single platform export") — so a
  local `goreleaser release --snapshot` needs `docker buildx create --use`
  first. QEMU is *not* needed — nothing executes under the target platform.
- **OCI metadata lives in two places on purpose.** Labels (image config) come
  from the `Dockerfile`'s `ARG`s, fed by `build_args`, so a hand-run build gets
  them too. Annotations (index + per-platform manifests) come from
  `dockers_v2.annotations`, because no Dockerfile can annotate the manifest
  that wraps it. `base.name` / `base.digest` are annotations only: GoReleaser
  reads them off the `FROM` line, so a Dependabot digest bump cannot leave a
  stale label behind.
- **`created` uses `.CommitDate`, not `.Date`.** The release builds under
  `SOURCE_DATE_EPOCH`; a wall-clock label would be the one thing that changes
  between two builds of the same tag.
- **`docker_digest` writes `dist/digests.txt`**, which the second
  `actions/attest` step consumes. It only exists when something was pushed —
  hence the `RELEASE_TAG != ''` gate, same as the checksums attestation.
- **Image tags are not immutable** the way the GitHub Release is. A re-run of
  the same tag overwrites `:0.1.1`. Digests and the attestations that pin them
  are unaffected.
- The GHCR package is **private until someone makes it public** once, by hand,
  in the package settings. `org.opencontainers.image.source` is what links the
  package to this repo.

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
`build(frontend)` / `chore(frontend)` (npm devDeps), `ci(actions)`,
`build(docker)` (the `Dockerfile` base image).

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
  `anchore/sbom-action`, `goreleaser/goreleaser-action`, `ossf/scorecard-action`,
  `docker/login-action`, `docker/setup-buildx-action` — plus the container base
  image, `gcr.io/distroless/static-debian13`. They appear only in `release.yml` /
  `scorecard.yml`; CI lints those files but never runs the action or builds the
  image, so a bump is unvalidated until a release fires — and a failed release
  burns a tag name. Every other action is also used by `ci.yml` or `codeql.yml`,
  so the PR's own run is the proof. **Keep that list in step with where actions
  are actually used.**

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

The hook runs only the gates a commit touches (Go / web / workflows /
lockfiles / `Dockerfile`), so a one-line web tweak doesn't pay for the Go race
suite — that is what keeps people off `--no-verify`. `PRE_COMMIT_ALL=1` forces
the full run. Trivy is the one gate that skips rather than fails when its
binary is missing locally; install it from <https://trivy.dev> if you touch the
`Dockerfile` often.

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
or the gate is unenforced.

Widening a license allow-list or narrowing a deny-list → do it in
`Makefile` (`GO_LICENSE_ALLOW`, `WEB_LICENSE_ALLOW`, `WEB_LICENSE_DENY`) and
in `ci.yml`'s `deny-licenses` together, with a comment saying why. The two
express the same policy at different moments: whole graph vs. what a PR adds.

They are deliberately **not** the same list. `ci.yml` pins
`fail-on-scopes: runtime`, so its stricter deny-list only ever judges code we
redistribute; the Makefile's `WEB_LICENSE_DENY` is the looser dev-only tier,
where a tool is executed rather than conveyed. Keep that asymmetry — flattening
the two would either let copyleft into the binary or ban an LGPL lint plugin.

**Write license ids however SPDX does today, and trust the normaliser, not the
string.** `check-licenses.mjs` folds `-only`, `-or-later` and `+` onto the bare
id before comparing, because `LGPL-3.0` and `LGPL-3.0-only` are the same
license and a raw string compare silently misses whichever spelling the policy
was not written in. That exact miss shipped once. The script self-tests the
matcher on every run; do not remove that. Changing a `make` target CI calls → verify both
sides still line up.

Bumping a pinned tool (`GOLANGCI_LINT_VERSION`, `GOVULNCHECK_VERSION`,
`ACTIONLINT_VERSION`, `ZIZMOR_VERSION`, `SEMGREP_VERSION`,
`GO_LICENSES_VERSION`, `DEADCODE_VERSION`, `OSV_SCANNER_VERSION`,
`TRIVY_VERSION`) → edit the `Makefile` only; CI reads it
back through `make -s print-<VAR>`. Dependabot does **not** track these — it
bumps `uses:` refs, not a version a make target hands to `go run` or `pip`, so
they are watched by hand. Do not try to fix that with one shared `tools/go.mod`:
MVS unifies every tool's graph, and golangci-lint raising `go.yaml.in/yaml/v4`
past what actionlint compiles against breaks `make actions-lint`. One module
per tool, or leave it.
