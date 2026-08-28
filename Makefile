BINARY := triage

GOLANGCI_LINT_VERSION := v2.13.2
# Pinned, not @latest: a scanner whose version drifts between runs makes a red
# build unreproducible and is itself an unpinned supply-chain dependency.
GOVULNCHECK_VERSION := v1.7.0
ACTIONLINT_VERSION := v1.7.9
ZIZMOR_VERSION := 1.29.0
GO_COVER_PKGS := ./internal/config ./internal/store
GO_COVER_FLOOR := 70

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
	web-deps web-lint web-test web-build web-dist-check web-ci actions-lint ci ci-go pre-commit hooks

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

cover-go:
	go test -covermode=atomic -coverprofile=coverage.out $(GO_COVER_PKGS)
	@go tool cover -func=coverage.out | awk -v floor=$(GO_COVER_FLOOR) '/^total:/{gsub("%","",$$NF); if ($$NF+0 < floor) { printf "Go coverage %.1f%% is below %s%%\n", $$NF, floor; exit 1 } printf "Go coverage %.1f%%\n", $$NF}'

## ci-go: the Go half of CI, the same targets the `go` job calls
ci-go: fmt-check fix-check vet lint test-race cover-go

## ci: everything CI gates on. The hook runs only the parts a commit touches.
ci: ci-go web-ci actions-lint

pre-commit: ci

hooks:
	@mkdir -p .git/hooks
	@cp .githooks/pre-commit .git/hooks/pre-commit
	@chmod +x .git/hooks/pre-commit
	@echo "installed .git/hooks/pre-commit (runs the CI gates for the paths a commit touches)"

clean:
	rm -f $(BINARY) coverage.out
	rm -rf web/dist web/node_modules dist

## print-<VAR>: echo one variable's value. CI resolves the pinned tool versions
## through this instead of repeating them, so a bump here cannot leave a stale
## copy behind in a workflow. Not listed in .PHONY: make does not expand
## patterns there, so the entry would read as protection it does not give.
print-%:
	@echo "$($*)"
