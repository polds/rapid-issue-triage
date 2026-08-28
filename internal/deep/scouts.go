package deep

import (
	"fmt"
	"strings"

	"github.com/polds/rapid-issue-triage/internal/store"
)

type scoutDef struct {
	Name   string
	Prompt func(issueCtx string) string
}

func (o *Orchestrator) enabledScouts(s store.EnrichSettings, a Availability) []scoutDef {
	var out []scoutDef
	if s.Sources.Repo.Enabled && a.Repo.Available {
		out = append(out, scoutDef{"repo", repoPrompt})
	}
	if s.Sources.GitHub.Enabled && a.GitHub.Available {
		out = append(out, scoutDef{"github", githubPrompt})
	}
	if s.Sources.Linear.Enabled && a.Linear.Available {
		out = append(out, scoutDef{"linear", linearPrompt})
	}
	if s.Sources.Datadog.Enabled && a.Datadog.Available {
		out = append(out, scoutDef{"datadog", datadogPrompt})
	}
	if s.Sources.Gcloud.Enabled && a.Gcloud.Available {
		out = append(out, scoutDef{"gcloud", gcloudPrompt})
	}
	return out
}

// issueContext renders the shared issue block every agent receives.
func issueContext(issue store.IssueRow, comments string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Identifier: %s\nTitle: %s\nCreated: %s\nUpdated: %s\nPriority: %d\n",
		issue.Identifier, issue.Title, issue.CreatedAt, issue.UpdatedAt, issue.Priority)
	if len(issue.Labels) > 0 {
		names := make([]string, 0, len(issue.Labels))
		for _, l := range issue.Labels {
			names = append(names, l.Name)
		}
		fmt.Fprintf(&b, "Labels: %s\n", strings.Join(names, ", "))
	}
	desc := issue.Description
	if len(desc) > 6000 {
		desc = desc[:6000] + "\n…(truncated)"
	}
	fmt.Fprintf(&b, "\nDescription:\n%s\n", desc)
	if comments != "" {
		fmt.Fprintf(&b, "\nComments (cached):\n%s\n", comments)
	}
	return b.String()
}

const scoutOutputContract = `
When you are done, reply with ONLY a JSON object (no fences, no prose):
{"summary": "<2-4 sentences: what you found>",
 "evidence": [{"finding": "<one concrete fact>", "link": "<url or file:line, optional>"}],
 "signal": "<one of: supports_actionable | supports_obsolete | supports_done | supports_duplicate | neutral>",
 "confidence": <0.0-1.0>}
Keep evidence to the 3-6 most decisive facts. If a tool call fails, note it and move on — never fabricate.`

func repoPrompt(issueCtx string) string {
	return `You are a read-only repository scout helping triage a Linear backlog issue. You can Read, Grep, and Glob the repository directories you were granted — nothing else. Do not modify anything.

Investigate whether this issue still applies to the codebase:
- Find the files, symbols, flags, or config the issue references. Do they still exist? Have they changed since the issue was written?
- Look for evidence the described problem was already fixed (the code now does what the issue asks) or made obsolete (the subsystem was removed/replaced).
- Cite file paths with line numbers.
` + scoutOutputContract + `

Issue:
` + issueCtx
}

func githubPrompt(issueCtx string) string {
	return `You are a read-only GitHub scout helping triage a Linear backlog issue. Your ONLY tool is the "triage-tool" command (run it via Bash). Available calls:
  triage-tool github.search-prs <query>     — search pull requests (supports qualifiers like repo:owner/name, is:merged)
  triage-tool github.search-code <query>    — search code
  triage-tool github.pr <owner/repo> <number> — PR details
All access is read-only and logged.

Investigate whether work related to this issue already landed:
- Search PRs for the issue identifier and for key phrases from the title/description.
- If you find candidate PRs, inspect them and judge whether they implement or obsolete this issue.
- Prefer merged PRs; note dates relative to the issue.
` + scoutOutputContract + `

Issue:
` + issueCtx
}

func linearPrompt(issueCtx string) string {
	return `You are a read-only Linear scout helping triage a backlog issue. Your ONLY tool is the "triage-tool" command (run it via Bash). Available calls:
  triage-tool linear.search <terms>       — search issues by title (or pass an identifier like ABC-123)
  triage-tool linear.issue <identifier>   — full issue with comments and state
All access is read-only and logged.

Investigate the issue's standing inside Linear itself:
- Search for duplicates or near-duplicates of this issue; check their states.
- Look up any issue identifiers referenced in the description/comments — are they done, canceled, or superseded?
- Judge whether this issue is a duplicate, already covered by completed work, or still unique and open.
` + scoutOutputContract + `

Issue:
` + issueCtx
}

func datadogPrompt(issueCtx string) string {
	return `You are a read-only Datadog scout helping triage a backlog issue. Your ONLY tool is the "triage-tool" command (run it via Bash). Available calls:
  triage-tool datadog.logs <query> [hours]  — search logs (default window 168h); use Datadog log search syntax
  triage-tool datadog.monitors <query>      — search monitors
All access is read-only and logged.

Investigate whether the problem described is still observable:
- If the issue describes an error/failure, search logs for its signature (service names, error strings). Is it still occurring? When was the last hit?
- Check for related monitors and their state.
- Absence of recent hits for a once-noisy error is evidence the issue may be resolved or obsolete.
` + scoutOutputContract + `

Issue:
` + issueCtx
}

func gcloudPrompt(issueCtx string) string {
	return `You are a read-only Google Cloud scout helping triage a backlog issue. Your ONLY tool is the "triage-tool" command (run it via Bash):
  triage-tool gcloud.run <gcloud args...>   — runs gcloud, restricted to read verbs (list, describe, get-iam-policy, read). --format=json is appended automatically.
All access is read-only and logged. Mutating verbs are rejected.

Investigate whether the infrastructure state the issue describes still holds:
- Inspect the resources/services the issue references (describe/list them).
- Judge whether the described gap or misconfiguration still exists.
Only investigate what the issue actually mentions; two or three targeted calls beat a survey.
` + scoutOutputContract + `

Issue:
` + issueCtx
}

func synthesisPrompt(issueCtx, resultsJSON string) string {
	return `You are the synthesis agent for a deep triage enrichment. Several read-only scouts investigated one Linear backlog issue; their raw outputs are below. Combine them into one final report.

Reply with ONLY a JSON object of exactly this shape (no fences, no prose):
{"verdict": "<one of: actionable | likely_obsolete | possibly_done | needs_info | duplicate_suspect>",
 "confidence": <0.0-1.0>,
 "summary": "<2-3 sentence plain-language summary of what this issue asks for>",
 "reasoning": "<2-4 sentences: how the evidence supports the verdict; name which sources agree or conflict>",
 "recommendation": "<one concrete next action for the triager, e.g. 'close as done, shipped in atum-core#1456' or 'keep; still reproducing in production logs'>",
 "evidence": [{"source": "<repo|github|linear|datadog|gcloud>", "finding": "<one concrete fact>", "link": "<url or file:line, optional>"}],
 "relatedIssues": [{"identifier": "ABC-123", "title": "...", "state": "...", "relation": "<duplicate|referenced|supersedes>", "url": "<linear issue url if known>"}],
 "relatedPRs": [{"repo": "owner/name", "number": 123, "title": "...", "state": "<merged|open|closed>", "url": "..."}]}

Rules: weigh scout confidence and errors (an errored scout contributes nothing); conflicting evidence lowers confidence and belongs in reasoning; keep evidence to the strongest 3-8 items across all sources; empty arrays are fine.

Issue:
` + issueCtx + `

Scout outputs:
` + resultsJSON
}
