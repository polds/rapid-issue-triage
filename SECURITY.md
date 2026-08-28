# Security Policy

## Supported versions

This is a single-binary local tool with no server-side deployment. Only the
latest released version receives fixes.

## Reporting a vulnerability

Report privately through GitHub's
[Report a vulnerability](https://github.com/polds/rapid-issue-triage/security/advisories/new)
form. Please do not open a public issue for an unfixed vulnerability.

Include what you need to reproduce it: version (`triage -version`), platform,
and the steps or request that triggers the behaviour. Expect an initial reply
within a week.

## Scope

`triage` runs on a developer's own machine, binds `127.0.0.1:7333`, and holds a
Linear API key plus any configured MCP source keys in a local sqlite database.
The published container listens on `0.0.0.0:7333` *inside its own network
namespace* — loopback there reaches nothing — and is documented to be published
to the host's loopback (`-p 127.0.0.1:7333:7333`). Publishing it to every
interface exposes an API that spawns subprocesses; that is a misconfiguration,
not a vulnerability, but the container defaulting to anything wider would be.
Findings that are in scope include:

- Anything that exposes stored keys to another local user or to the network
- Reaching the loopback API from a web page (CSRF, DNS rebinding, permissive CORS)
- Issue content from Linear escaping into command execution or the DOM
- Supply-chain weaknesses in the release pipeline or its published artifacts

Out of scope: an attacker who already has code execution as the user running
`triage`, and the deliberate `-no-open` / local-file behaviours documented in
the README.

## Verifying a release

Release archives ship with SPDX SBOMs, a `checksums.txt`, and GitHub build
provenance. Verify a download before running it:

```sh
gh attestation verify triage_<version>_<platform>.tar.gz --repo polds/rapid-issue-triage
```

The container image carries the same provenance, plus a BuildKit SBOM
attestation:

```sh
gh attestation verify oci://ghcr.io/polds/rapid-issue-triage:<version> --repo polds/rapid-issue-triage
```
