package deep

import (
	"github.com/polds/rapid-issue-triage/internal/store"
)

// streamState is what one `claude` invocation left behind: its final reply,
// whether the CLI flagged an error, and the accounting off the same line.
type streamState struct {
	final   string
	isError bool
	acct    resultUsage
}

// resultUsage is the token accounting the CLI prints on its final `result`
// line. internal/ai decodes the identical shape off `--output-format json`;
// the packages are siblings so each owns its decode. Change one, check the
// other.
type resultUsage struct {
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

// usage converts the accounting into a store row. Run, issue and agent are
// stamped by the orchestrator, which is the only caller that knows them.
func (st streamState) usage(model string) store.TokenUsage {
	if model == "" {
		model = dominantModel(st.acct.ModelUsage)
	}
	return store.TokenUsage{
		Mode: "deep", Model: model,
		CostUSD:       st.acct.TotalCostUSD,
		Input:         st.acct.Usage.InputTokens,
		Output:        st.acct.Usage.OutputTokens,
		CacheCreation: st.acct.Usage.CacheCreationTokens,
		CacheRead:     st.acct.Usage.CacheReadTokens,
		DurationMS:    st.acct.DurationMS,
	}
}

// dominantModel names the costliest model in a modelUsage map. The CLI bills
// small housekeeping calls to a cheap model alongside the one that answered,
// so "most expensive" picks the model that actually did the work. Used only
// when no model was configured and the CLI chose its own default.
func dominantModel(mu map[string]cliModelUsage) string {
	best, top := "", 0.0
	for name, u := range mu {
		if name != "" && (best == "" || u.CostUSD > top) {
			best, top = name, u.CostUSD
		}
	}
	return best
}
