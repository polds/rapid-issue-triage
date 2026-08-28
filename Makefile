BINARY := triage

GOLANGCI_LINT_VERSION := v2.13.2
# Pinned, not @latest: a scanner whose version drifts between runs makes a red
# build unreproducible and is itself an unpinned supply-chain dependency.
GOVULNCHECK_VERSION := v1.7.0
ACTIONLINT_VERSION := v1.7.9
ZIZMOR_VERSION := 1.29.0
SEMGREP_VERSION := 1.175.0
GO_LICENSES_VERSION := v1.6.0
DEADCODE_VERSION := v0.47.0
GO_COVER_PKGS := ./internal/config ./internal/store
GO_COVER_FLOOR := 70

# SAST rulesets. p/gosec and p/golang cover the backend, p/typescript and
# p/react the frontend, p/dockerfile the released image, and p/secrets is a
# second pass over what gitleaks already greps for -- gitleaks matches shapes,
# semgrep matches use sites.
SEMGREP_CONFIGS := --config=p/golang --config=p/gosec --config=p/typescript \
	--config=p/react --config=p/dockerfile --config=p/secrets
SEMGREP_EXCLUDES := --exclude=web/dist --exclude=node_modules
SEMGREP_SARIF := semgrep.sarif

# License policy, in two tiers, because the two sets are used differently.
#
# Tier 1 -- redistributed. Everything reachable from the Go build, and
# everything npm bundles into web/dist (which go:embed then compiles in), ships
# inside the released binary. Both are held to an explicit allow-list of
# permissive licenses. OFL-1.1 is on the web list for the two @fontsource
# packages: it permits redistributing the font files, which is what web/dist
# does.
#
# Tier 2 -- dev-only. A lint plugin or a bundler is *executed*, never conveyed,
# and copyleft obligations attach to conveying a work. So the dev tier denies
# only the licenses whose terms can bite a tool you merely run, or that signal
# a licensing trap: GPL and AGPL (AGPL's network clause in particular), the
# source-available licenses, and non-commercial terms. LGPL, MPL and EPL are
# deliberately absent -- their obligations are file- or library-scoped and
# reach nothing we distribute. This is why eslint-plugin-sonarjs (LGPL-3.0-only)
# is allowed while nothing copyleft can reach the binary.
#
# Both lists are matched through the SPDX normaliser in check-licenses.mjs, so
# `GPL-3.0`, `GPL-3.0-only` and `GPL-3.0-or-later` all match one entry here.
GO_LICENSE_ALLOW := Apache-2.0,MIT,BSD-2-Clause,BSD-3-Clause,ISC
WEB_LICENSE_ALLOW := Apache-2.0,MIT,BSD-2-Clause,BSD-3-Clause,ISC,0BSD,Unlicense,CC0-1.0,OFL-1.1,BlueOak-1.0.0
WEB_LICENSE_DENY := GPL-1.0,GPL-2.0,GPL-3.0,AGPL-1.0,AGPL-3.0,SSPL-1.0,BUSL-1.1,CC-BY-NC-4.0,CC-BY-NC-SA-4.0,Commons-Clause
# go-licenses' classifier is old enough to miss BSD variants at its default
# 0.9 confidence (modernc.org/mathutil reports Unknown). 0.8 classifies every
# module in this graph correctly; verify with `make licenses-report`.
GO_LICENSE_CONFIDENCE := 0.8

# web/node_modules is gitignored but ships Go sources of its own (eslint pulls
# in flatted, which vendors a Go implementation). `./...` does not skip it, so
# after a local `npm install` every ./... command would pick it up. Resolve the
# package list without it, and format-check only tracked files.
GO_PKGS = $(shell go list ./... | grep -v '/node_modules/')
# `go run tool@version` otherwise builds the tool with whatever toolchain the
# tool's own go.mod asks for, which may be older than this module's Go version.
# A govulncheck built that way cannot parse our packages at all.
GO_TOOLCHAIN = go$(shell go list -m -f '{{.GoVersion}}')
GO_FILES = $(shell git ls-files '*.go')

.PHONY: all build ui go dev clean test test-race vet fmt-check fix-check lint vuln cover-go \
	web-deps web-lint web-test web-build web-dist-check web-ci actions-lint sast \
	licenses licenses-go licenses-web licenses-report quality tidy-check deadcode \
	ci ci-go ci-security pre-commit hooks

all: build

## build: build the web UI and embed it into the Go binary
build: ui go

ui:
	cd web && npm install --no-fund --no-audit && npm run build

go:
	go build -o $(BINARY) ./cmd/triage

## dev: run the Go server + Vite dev server (UI on :5173, proxying /api)
dev:
	@echo "Run in two terminals:"
	@echo "  go run ./cmd/triage -no-open"
	@echo "  cd web && npm run dev"

test:
	go test $(GO_PKGS)

## test-race: same tests under the race detector (what CI runs)
test-race:
	go test -race $(GO_PKGS)

vet:
	go vet $(GO_PKGS)

fmt-check:
	@files="$$(gofmt -l $(GO_FILES))"; if [ -n "$$files" ]; then echo "$$files"; exit 1; fi

fix-check:
	go fix -diff $(GO_PKGS)

lint:
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION) run ./...

## vuln: report known vulnerabilities reachable from this module's code
vuln:
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION) $(GO_PKGS)

## web-deps: install web/node_modules when the lockfile is newer than the tree
web-deps:
	@if [ ! -d web/node_modules ] || [ web/package-lock.json -nt web/node_modules ]; then \
		echo "installing web deps"; \
		npm --prefix web ci; \
	fi

web-lint: web-deps
	npm --prefix web run lint

web-test: web-deps
	npm --prefix web run coverage

web-build: web-deps
	npm --prefix web run build

## web-dist-check: fail when the committed web/dist does not match a fresh build
# web/dist is tracked on purpose: webui.go embeds it, so `go install`-ing this
# module has to compile without anyone running npm. That only works while the
# committed bundle matches web/src, and nothing else notices when it stops -
# CI builds into an artifact and never reads the committed copy.
#
# Only the worktree column of `git status` is inspected (`awk substr($$0,2,1)`),
# so a rebuilt bundle that has already been `git add`ed passes. Otherwise the
# pre-commit hook could never be satisfied: it builds into the worktree, and the
# fix for a stale bundle is to stage it.
web-dist-check: web-build
	@drift=$$(git status --porcelain -- web/dist | awk 'substr($$0,2,1) != " "'); \
	if [ -n "$$drift" ]; then \
		echo "web/dist does not match a build of web/src:"; \
		echo "$$drift"; \
		echo; \
		echo "webui.go embeds web/dist, so a plain checkout compiles the committed"; \
		echo "bundle. Run 'make web-build' and 'git add web/dist' with your change."; \
		exit 1; \
	fi
	@echo "web/dist matches a fresh build"

## web-ci: the frontend gates CI runs (eslint, vitest + coverage floor, build, dist freshness)
web-ci: web-lint web-test web-build web-dist-check

## actions-lint: what the CI "Workflow lint" job runs over .github/workflows
# --no-online-audits keeps this deterministic and token-free: zizmor's online
# audits hard-fail with a 401 when unauthenticated, and the checks they add
# (ref freshness) are already Dependabot's job. zizmor is optional locally but
# required in CI, so a missing binary can never silently skip the audit.
actions-lint:
	@if ! command -v shellcheck >/dev/null 2>&1; then \
		if [ -n "$$CI" ]; then \
			echo "shellcheck is required in CI but is not installed"; \
			exit 1; \
		fi; \
		echo "warning: shellcheck not installed - actionlint will SKIP every run: block."; \
		echo "         CI runners have it, so a clean local run proves less than it looks."; \
		echo "         Install: apt-get install shellcheck (or brew install shellcheck)"; \
	fi
	go run github.com/rhysd/actionlint/cmd/actionlint@$(ACTIONLINT_VERSION)
	@if command -v zizmor >/dev/null 2>&1; then \
		zizmor --no-online-audits --format plain .github/workflows; \
	elif [ -n "$$CI" ]; then \
		echo "zizmor is required in CI but is not installed"; \
		exit 1; \
	else \
		echo "zizmor not installed - skipping. Install: pipx install zizmor==$(ZIZMOR_VERSION)"; \
	fi

## sast: static application security testing over both halves of the tree.
# Semgrep is the one scanner that reads Go and TSX with the same engine, so
# backend and frontend share a single gate instead of drifting apart. It
# complements CodeQL rather than replacing it: different rule authors, and
# this one runs inside `make ci` where a contributor sees it before pushing.
# --error turns findings into a non-zero exit; the SARIF file is what CI
# uploads to the Security tab, and is written even on a clean run.
# Optional locally, required in CI -- same contract as zizmor above.
sast:
	@if command -v semgrep >/dev/null 2>&1; then \
		semgrep scan $(SEMGREP_CONFIGS) $(SEMGREP_EXCLUDES) \
			--metrics=off --error --sarif-output=$(SEMGREP_SARIF) .; \
	elif [ -n "$$CI" ]; then \
		echo "semgrep is required in CI but is not installed"; \
		exit 1; \
	else \
		echo "semgrep not installed - skipping. Install: pipx install semgrep==$(SEMGREP_VERSION)"; \
	fi

## licenses: fail on a dependency license this project cannot redistribute
licenses: licenses-go licenses-web

# go-licenses resolves the license of every module reachable from the packages
# we actually build -- $(GO_PKGS), not ./..., so a local `npm install` cannot
# drag web/node_modules' vendored Go sources into the report.
licenses-go:
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go run github.com/google/go-licenses@$(GO_LICENSES_VERSION) \
		check --confidence_threshold=$(GO_LICENSE_CONFIDENCE) \
		--allowed_licenses=$(GO_LICENSE_ALLOW) $(GO_PKGS)

# `npm query` is npm's own dependency-tree query, so this needs no extra
# package -- a license scanner pulled in to audit the supply chain is itself
# supply chain. `.prod` is what vite bundles into web/dist and ships; the rest
# is dev tooling that never leaves the machine.
licenses-web: web-deps
	ALLOW="$(WEB_LICENSE_ALLOW)" DENY="$(WEB_LICENSE_DENY)" \
		node web/scripts/check-licenses.mjs

## licenses-report: print every dependency license instead of just the failures
licenses-report: web-deps
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go run github.com/google/go-licenses@$(GO_LICENSES_VERSION) \
		csv --confidence_threshold=$(GO_LICENSE_CONFIDENCE) $(GO_PKGS)
	@ALLOW="$(WEB_LICENSE_ALLOW)" DENY="$(WEB_LICENSE_DENY)" \
		node web/scripts/check-licenses.mjs --report

## quality: maintainability gates that are not any one language's linter
# The per-language code quality gates live in golangci-lint (gocyclo, dupl,
# unused, revive) and eslint (sonarjs). These two are what neither owns.
quality: tidy-check deadcode

# An untidy go.mod/go.sum is how a dependency nobody imports keeps its place
# in the graph -- and in every vulnerability and license report downstream.
tidy-check:
	go mod tidy -diff

# golangci-lint's `unused` only sees within a package. deadcode does whole
# program reachability from the real entry points, which is what catches an
# exported method no call site reaches any more.
#
# -test over every package, not just ./cmd/triage: without it each package's
# own tests stop counting as entry points, and a helper that exists for its
# test reads as dead. That is the wrong trade for a codebase whose store
# package is gated on coverage.
deadcode:
	@out="$$(GOTOOLCHAIN=$(GO_TOOLCHAIN) go run golang.org/x/tools/cmd/deadcode@$(DEADCODE_VERSION) -test $(GO_PKGS))" || { \
		echo "deadcode failed to analyse the packages (see the error above)"; \
		exit 1; \
	}; \
	if [ -n "$$out" ]; then \
		echo "$$out"; \
		echo "unreachable from any entry point (including tests) - delete it or call it"; \
		exit 1; \
	fi; \
	echo "no unreachable functions"

cover-go:
	go test -covermode=atomic -coverprofile=coverage.out $(GO_COVER_PKGS)
	@go tool cover -func=coverage.out | awk -v floor=$(GO_COVER_FLOOR) '/^total:/{gsub("%","",$$NF); if ($$NF+0 < floor) { printf "Go coverage %.1f%% is below %s%%\n", $$NF, floor; exit 1 } printf "Go coverage %.1f%%\n", $$NF}'

## ci-go: the Go half of CI, the same targets the `go` job calls
ci-go: fmt-check fix-check vet lint test-race cover-go

## ci-security: the scanners CI gates on that are not tied to one language
ci-security: vuln sast licenses

## ci: everything CI gates on. The hook runs only the parts a commit touches.
ci: ci-go web-ci actions-lint quality ci-security

pre-commit: ci

hooks:
	@mkdir -p .git/hooks
	@cp .githooks/pre-commit .git/hooks/pre-commit
	@chmod +x .git/hooks/pre-commit
	@echo "installed .git/hooks/pre-commit (runs the CI gates for the paths a commit touches)"

clean:
	rm -f $(BINARY) coverage.out $(SEMGREP_SARIF)
	rm -rf web/dist web/node_modules dist

## print-<VAR>: echo one variable's value. CI resolves the pinned tool versions
## through this instead of repeating them, so a bump here cannot leave a stale
## copy behind in a workflow. Not listed in .PHONY: make does not expand
## patterns there, so the entry would read as protection it does not give.
print-%:
	@echo "$($*)"
