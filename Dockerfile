# Runtime image for rapid-issue-triage. Built and published by the release
# workflow through GoReleaser's `dockers_v2` section -- see .goreleaser.yaml.
#
# There is deliberately no builder stage. GoReleaser has already compiled the
# binary for every target platform (reproducibly, with the web UI embedded) and
# lays them out in the build context as <os>/<arch>[/<variant>]/triage. Adding a
# `go build` here would ship a *different* binary from the one the release
# archives and the SLSA provenance attest.
#
# The context is a temporary directory holding only those binaries, so a bare
# `docker build .` from the repo root cannot work. To build one by hand:
#
#   docker buildx create --use          # docker-container driver; see below
#   goreleaser release --snapshot --clean
#
# That builder is not optional even locally: the default `docker` driver rejects
# the `index:`-scoped OCI annotations on a single-platform export.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:1c2c046bc09ed40fad370b599a0b1ae7987f55b01e247cf27a7c27cd97e5bbc7

# Build metadata, passed in by GoReleaser (`build_args` in .goreleaser.yaml).
# The defaults are what a hand-run build gets: honest placeholders rather than a
# plausible-looking lie about which commit is inside the image.
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=1970-01-01T00:00:00Z
ARG SOURCE=https://github.com/polds/rapid-issue-triage

# OCI image-config labels. The matching annotations on the image index and the
# per-platform manifests are set by GoReleaser, which is the only place they can
# be set -- a Dockerfile cannot annotate the manifest that wraps it.
#
# org.opencontainers.image.source is load-bearing beyond metadata: it is what
# links the published package to this repository on GHCR (inheriting its
# visibility and letting the package page render the README).
#
# base.name / base.digest are deliberately absent here and set as annotations
# instead: GoReleaser reads them off the FROM line above, so a Dependabot bump
# of the pinned digest cannot leave a stale label behind.
LABEL org.opencontainers.image.title="rapid-issue-triage" \
      org.opencontainers.image.description="Local-only, keyboard-first triage for Linear backlogs" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.url="${SOURCE}" \
      org.opencontainers.image.documentation="${SOURCE}#readme" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="polds"

ARG TARGETPLATFORM
COPY ${TARGETPLATFORM}/triage /usr/bin/triage

# Apache 2.0 section 4: the licence travels with the redistributed work. Same
# path the deb/rpm/apk packages use. Listed in dockers_v2.extra_files, since the
# build context holds only what GoReleaser puts in it.
COPY LICENSE /usr/share/doc/triage/LICENSE

# The sqlite index and the optional ~/.rapid-triage/.env live under $HOME. The
# distroless base sets no HOME, and Go's os.UserHomeDir reads the environment
# rather than /etc/passwd, so without this the database would land in a relative
# .rapid-triage/ that a read-only or recreated container silently loses.
ENV HOME=/data

# Ownership matters: /data is the declared volume, so Docker seeds a named
# volume from it, permissions included. BuildKit creates a WORKDIR owned by the
# image's current user, hence the explicit USER first. (The classic pre-BuildKit
# builder would create it root-owned; GoReleaser always builds with buildx.)
USER 65532:65532
WORKDIR /data
VOLUME ["/data"]

EXPOSE 7333

# -no-open: there is no browser in the container to open.
# -addr 0.0.0.0:7333: loopback inside a network namespace is reachable from
# nothing at all. The listener is still meant to be private -- publish it to the
# host's loopback only (`-p 127.0.0.1:7333:7333`), never to 0.0.0.0. /api/pick
# and /api/toolbox spawn subprocesses; see SECURITY.md.
#
# Flags are on the ENTRYPOINT rather than the CMD so that appending arguments
# (`docker run ... -config /data/rapid-triage.yaml`) extends them instead of
# dropping them. Go's flag package takes the last occurrence, so a caller can
# still override -addr by passing their own.
ENTRYPOINT ["/usr/bin/triage", "-no-open", "-addr", "0.0.0.0:7333"]
