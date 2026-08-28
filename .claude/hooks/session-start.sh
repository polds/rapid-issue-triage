#!/bin/bash
# SessionStart hook: bootstrap OpenWolf (https://openwolf.com/).
#
# Claude Code on the web runs in ephemeral containers: the repo is cloned
# fresh and a global npm install does not survive into the next session. This
# script restores the `openwolf` CLI on every session start.
#
# What this repo needs it for: the six OpenWolf hooks under .wolf/hooks/ are
# committed here (dependency-free ESM, run by node directly), so they already
# work on a fresh clone without any install. What is NOT committed is the
# `openwolf` CLI itself, and the protocol in .wolf/OPENWOLF.md depends on it —
# `openwolf scan` to regenerate .wolf/anatomy.md, `openwolf designqc` for the
# design-QC screenshots. Without this script those commands are simply absent
# and anatomy.md drifts until someone edits it by hand.
#
# Because .wolf/ is tracked in this repo, the init step below is always
# skipped; the install is the part that matters. The guard is kept so the
# script still does the right thing in a checkout where .wolf/ is absent.
#
# Idempotent and fail-soft by design: a missing dependency or a transient
# install failure must never block the session from starting.

set -uo pipefail

# Only run in remote (Claude Code on the web) sessions. Local sessions are
# expected to manage their own OpenWolf install.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

log() { printf '[openwolf] %s\n' "$*" >&2; }

if ! command -v npm >/dev/null 2>&1; then
    log "npm not found — skipping OpenWolf setup"
    exit 0
fi

if ! command -v openwolf >/dev/null 2>&1; then
    log "installing openwolf via npm install -g..."
    if ! npm install -g openwolf >/dev/null 2>&1; then
        log "install failed — skipping init"
        exit 0
    fi
fi

# openwolf init creates .wolf/ and registers its six hooks. Treat the
# presence of .wolf/ as the idempotency marker; re-running init is safe
# but wasteful on every session.
if [ ! -d ".wolf" ]; then
    log "running openwolf init..."
    if ! openwolf init >&2; then
        log "openwolf init failed — continuing without it"
        exit 0
    fi
    log "openwolf initialized"
else
    log "already initialized (.wolf exists) — skipping init"
fi

exit 0
