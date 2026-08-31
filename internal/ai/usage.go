package ai

import (
	"github.com/polds/rapid-issue-triage/internal/store"
)

// cliEnvelope is what `claude -p --output-format json` prints: the reply text
// plus the CLI's own accounting for the call. Reading `usage` is why the
// reports page can show real token counts instead of an estimate.
//
// internal/deep parses the same fields off the final `result` line of
// --output-format stream-json; the two shapes are identical, but the packages
// are siblings so each owns its decode. Change one, check the other.
type cliEnvelope struct {
	Result       string                   `json:"result"`
	IsErr        bool                     `json:"is_error"`
	TotalCostUSD float64                  `json:"total_cost_usd"`
	DurationMS   int64                    `json:"duration_ms"`
	Usage        cliUsage                 `json:"usage"`
	ModelUsage   map[string]cliModelUsage `json:"modelUsage"`
}

type cliUsage struct {
	InputTokens         int64 `json:"input_tokens"`
	OutputTokens        int64 `json:"output_tokens"`
	CacheCreationTokens int64 `json:"cache_creation_input_tokens"`
	CacheReadTokens     int64 `json:"cache_read_input_tokens"`
}

// cliModelUsage is the per-model split reported alongside the totals. Only the
// cost is read, to name the model that did the work.
type cliModelUsage struct {
	CostUSD float64 `json:"costUSD"`
}

// usage converts the envelope into the row the store records, tagged as the
// fast enricher's spend.
func (e cliEnvelope) usage(issueID, model string) store.TokenUsage {
	if model == "" {
		model = dominantModel(e.ModelUsage)
	}
	return store.TokenUsage{
		IssueID: issueID, Mode: "fast", Agent: "fast", Model: model,
		CostUSD:       e.TotalCostUSD,
		Input:         e.Usage.InputTokens,
		Output:        e.Usage.OutputTokens,
		CacheCreation: e.Usage.CacheCreationTokens,
		CacheRead:     e.Usage.CacheReadTokens,
		DurationMS:    e.DurationMS,
	}
}

// dominantModel names the costliest model in a modelUsage map. The CLI bills
// small housekeeping calls to a cheap model alongside the one that answered,
// so "most expensive" picks the model that actually did the analysis. Used
// only when no model was configured and the CLI chose its own default.
func dominantModel(mu map[string]cliModelUsage) string {
	best, top := "", 0.0
	for name, u := range mu {
		if name != "" && (best == "" || u.CostUSD > top) {
			best, top = name, u.CostUSD
		}
	}
	return best
}
