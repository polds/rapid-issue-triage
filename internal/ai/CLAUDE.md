# internal/ai — fast enrichment (one Claude call)

The `fast` half of enrichment: a single `claude -p` invocation per issue that
returns a summary and a relevancy verdict. No tools, no streaming, no
credentials — it shells out to the Claude Code CLI, so there is no API key.

The `deep` half is [`internal/deep`](../deep/CLAUDE.md); Settings
(`EnrichSettings.Mode`) picks between them. The two share a verdict
vocabulary and both land in `store.Enrichment`.

## Layout

Single file, `enrich.go`: `Enricher` (`Command`, `Model`, `Timeout`),
`Enrich`, `buildPrompt`, `parseResult`, `truncate`.

## Invariants

- **Verdicts are a closed set**, shared with `internal/deep` and the UI:
  `actionable | likely_obsolete | possibly_done | needs_info | duplicate_suspect`.
  Adding one means touching `buildPrompt`, `deep.synthesisPrompt`,
  `verdictLabels` in `internal/server/reportcomment.go`, and `VERDICT_META` in
  `web/src/components/triage/report-format.ts`.
- **`parseResult` must tolerate chatter.** Claude wraps JSON in prose or
  fences often enough that strict decoding is a bug, not a safeguard. It
  extracts the object; keep it lenient.
- **Inputs are truncated before prompting.** Issue bodies and comment threads
  are unbounded user content; `truncate` caps them so one huge issue cannot
  blow the context or the timeout.
- **The binary is resolved by the caller, per request.** `Enricher.Command`
  is set from `EnrichSettings.ClaudePath` falling back to config `ai.command`.
  An `Enricher` is constructed even when `claude` is absent, so saving a path
  in Settings enables enrichment without a restart. Do not add a startup
  `LookPath` guard that skips construction.
- **`Timeout` is always set by the caller** (`ai.timeout`, default 3m) and
  enforced with a context. A missing timeout means a wedged CLI holds a
  goroutine forever.
- **Results are cached by content hash**, not by issue id — see
  `store.IssueContentHash`. This package does not manage the cache;
  `internal/server` does.

## Gotchas

- `golangci-lint` excludes `G204` here: executing a user-configured binary is
  the point. It is not a licence to interpolate user text into a shell — the
  prompt is passed as an argument, never through `sh -c`.
- Issue text reaches the model verbatim. Treat anything it returns as data:
  the verdict is validated against the closed set, and the summary is rendered
  as text, never as HTML or a link target.

## Maintenance

Prompt changes are behaviour changes — they alter every future enrichment and
invalidate nothing (cached rows keep their old wording). Bump nothing, but say
so in the PR.
