// Package ai shells out to the Claude Code CLI (no API key required) to
// enrich issues with a summary and a relevancy verdict.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/polds/rapid-issue-triage/internal/store"
)

type Enricher struct {
	Command string
	Model   string
	Timeout time.Duration
}

type result struct {
	Summary    string  `json:"summary"`
	Verdict    string  `json:"verdict"`
	Reasoning  string  `json:"reasoning"`
	Confidence float64 `json:"confidence"`
}

var allowedVerdicts = map[string]bool{
	"actionable": true, "likely_obsolete": true, "possibly_done": true,
	"needs_info": true, "duplicate_suspect": true,
}

// Enrich runs Claude Code in print mode over the issue context and parses the
// structured verdict out of the reply. The second return is the call's token
// accounting, tagged as the "fast" responsibility for the reports page; it is
// meaningful even when the error is non-nil, since the tokens were still
// spent. Persisting it is the caller's job, as with the enrichment itself.
func (e *Enricher) Enrich(ctx context.Context, issue store.IssueRow, comments string) (store.Enrichment, store.TokenUsage, error) {
	ctx, cancel := context.WithTimeout(ctx, e.timeout())
	defer cancel()

	prompt := buildPrompt(issue, comments)
	args := []string{"-p", "--output-format", "json"}
	if e.Model != "" {
		args = append(args, "--model", e.Model)
	}
	cmd := exec.CommandContext(ctx, e.Command, args...)
	cmd.Stdin = strings.NewReader(prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return store.Enrichment{}, store.TokenUsage{}, fmt.Errorf("claude run: %w: %s", err, truncate(stderr.String(), 400))
	}

	// claude -p --output-format json wraps the reply in {"result": "..."}.
	var envelope cliEnvelope
	if err := json.Unmarshal(stdout.Bytes(), &envelope); err != nil {
		return store.Enrichment{}, store.TokenUsage{}, fmt.Errorf("claude output decode: %w: %s", err, truncate(stdout.String(), 400))
	}
	// The tokens were spent whatever the reply says, so usage is returned on
	// the failure paths below too — the caller records it either way.
	usage := envelope.usage(issue.ID, e.Model)
	if envelope.IsErr {
		return store.Enrichment{}, usage, fmt.Errorf("claude error: %s", truncate(envelope.Result, 400))
	}
	res, err := parseResult(envelope.Result)
	if err != nil {
		return store.Enrichment{}, usage, err
	}
	if !allowedVerdicts[res.Verdict] {
		res.Verdict = "actionable"
	}
	if res.Confidence < 0 || res.Confidence > 1 {
		res.Confidence = 0.5
	}
	return store.Enrichment{
		IssueID: issue.ID, Summary: res.Summary, Verdict: res.Verdict,
		Reasoning: res.Reasoning, Confidence: res.Confidence, Model: e.Model,
	}, usage, nil
}

func (e *Enricher) timeout() time.Duration {
	if e.Timeout > 0 {
		return e.Timeout
	}
	return 3 * time.Minute
}

var jsonBlock = regexp.MustCompile(`(?s)\{.*\}`)

func parseResult(text string) (result, error) {
	var r result
	// The model is asked for bare JSON but may wrap it in fences or prose.
	m := jsonBlock.FindString(text)
	if m == "" {
		return r, fmt.Errorf("no JSON object in claude reply: %s", truncate(text, 300))
	}
	if err := json.Unmarshal([]byte(m), &r); err != nil {
		return r, fmt.Errorf("claude reply JSON: %w: %s", err, truncate(m, 300))
	}
	if r.Summary == "" {
		return r, errors.New("claude reply missing summary")
	}
	return r, nil
}

func buildPrompt(issue store.IssueRow, comments string) string {
	var b strings.Builder
	b.WriteString(`You are a triage assistant reviewing a Linear backlog issue. Analyze it and respond with ONLY a JSON object (no markdown fences, no prose) of this exact shape:
{"summary": "<2-3 sentence plain-language summary of what this issue asks for>", "verdict": "<one of: actionable | likely_obsolete | possibly_done | needs_info | duplicate_suspect>", "reasoning": "<1-2 sentences justifying the verdict, e.g. age, references to since-shipped work, vagueness>", "confidence": <0.0-1.0>}

Verdict guide:
- actionable: still a real, well-defined task worth triaging into work.
- likely_obsolete: references systems/behavior that have probably changed; age and context suggest it no longer applies.
- possibly_done: reads like work that may already be completed but never closed.
- needs_info: too vague to act on without more detail.
- duplicate_suspect: reads like a common/duplicate request.

Issue:
`)
	fmt.Fprintf(&b, "Identifier: %s\nTitle: %s\nCreated: %s\nPriority: %d\n", issue.Identifier, issue.Title, issue.CreatedAt, issue.Priority)
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
		if len(comments) > 4000 {
			comments = comments[:4000] + "\n…(truncated)"
		}
		fmt.Fprintf(&b, "\nComments:\n%s\n", comments)
	}
	return b.String()
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
