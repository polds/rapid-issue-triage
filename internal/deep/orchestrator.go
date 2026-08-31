package deep

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/polds/rapid-issue-triage/internal/store"
)

// Orchestrator fans out scout agents over enabled sources, streams progress
// events (persisted + broadcast), and synthesizes the final report.
//
// Runs are pooled: at most MaxConcurrent execute at once and the rest wait in
// a FIFO line. One run is already a fanout of `claude` subprocesses, so an
// unbounded pile of them would starve the machine the user is triaging on.
type Orchestrator struct {
	Store   *store.Store
	Toolbox *Toolbox
	Command string // claude binary
	Model   string
	Timeout time.Duration
	Addr    string // this server's listen address, for the toolbox shim
	// MaxConcurrent bounds simultaneously executing runs (default 2).
	MaxConcurrent int

	mu   sync.Mutex
	runs map[string]*run
	// queue holds runs accepted but not yet executing, oldest first, and
	// active counts the ones that are. Both are guarded by mu.
	queue  []*pending
	active int
	// shimDir holds the triage-tool shim placed on scout PATHs.
	shimDir string
}

type run struct {
	id     string
	token  string
	seq    int64
	mu     sync.Mutex
	subs   map[chan store.EnrichEvent]struct{}
	cancel context.CancelFunc
	done   bool
	// queuePos is the last place-in-line announced for this run, so a
	// re-drain only emits an event when the position actually moved.
	queuePos int
}

// pending is a run waiting for a pool slot, holding everything execute needs.
type pending struct {
	r        *run
	ctx      context.Context
	issue    store.IssueRow
	settings store.EnrichSettings
}

// waiting pairs a queued run with its 1-based place in line, snapshotted
// under the lock so the events can be emitted after releasing it.
type waiting struct {
	r     *run
	issue string
	pos   int
}

// Placement is where a freshly requested run landed: executing right away, or
// queued behind others. Position is 1-based and 0 when the run is executing.
type Placement struct {
	ID       string `json:"runId"`
	Status   string `json:"status"`
	Position int    `json:"position,omitempty"`
}

func NewOrchestrator(st *store.Store, tb *Toolbox, command, model string, timeout time.Duration, addr string, maxConcurrent int) (*Orchestrator, error) {
	o := &Orchestrator{
		Store: st, Toolbox: tb, Command: command, Model: model,
		Timeout: timeout, Addr: addr, MaxConcurrent: maxConcurrent,
		runs: map[string]*run{},
	}
	// Install the shim once: scouts get this dir prepended to PATH.
	dir, err := os.MkdirTemp("", "rt-shim-")
	if err != nil {
		return nil, err
	}
	self, err := os.Executable()
	if err != nil {
		return nil, err
	}
	shim := fmt.Sprintf("#!/bin/sh\nexec %q tool \"$@\"\n", self)
	if err := os.WriteFile(filepath.Join(dir, "triage-tool"), []byte(shim), 0o755); err != nil {
		return nil, err
	}
	o.shimDir = dir
	// Runs from a previous process can never complete; mark them failed so
	// the UI doesn't wait on them forever.
	if n, err := st.FailOrphanRuns(); err == nil && n > 0 {
		fmt.Printf("deep: marked %d orphaned run(s) from a previous process as failed\n", n)
	}
	return o, nil
}

func (o *Orchestrator) timeout() time.Duration {
	if o.Timeout > 0 {
		return o.Timeout
	}
	return 4 * time.Minute
}

func (o *Orchestrator) maxConcurrent() int {
	if o.MaxConcurrent > 0 {
		return o.MaxConcurrent
	}
	return 2
}

// ValidateToken maps a toolbox token back to its run (auth for shim calls).
func (o *Orchestrator) ValidateToken(token string) (string, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for id, r := range o.runs {
		if r.token == token && !r.done {
			return id, true
		}
	}
	return "", false
}

// Subscribe returns a channel receiving live events for a run (nil if the
// run is not in memory — caller should replay from the store only).
func (o *Orchestrator) Subscribe(runID string) (chan store.EnrichEvent, func()) {
	o.mu.Lock()
	r, ok := o.runs[runID]
	o.mu.Unlock()
	if !ok {
		return nil, func() {}
	}
	ch := make(chan store.EnrichEvent, 256)
	r.mu.Lock()
	r.subs[ch] = struct{}{}
	r.mu.Unlock()
	return ch, func() {
		r.mu.Lock()
		delete(r.subs, ch)
		r.mu.Unlock()
	}
}

func (o *Orchestrator) emit(r *run, agent, kind string, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		b = []byte(`{}`)
	}
	r.mu.Lock()
	r.seq++
	seq := r.seq
	ev := store.EnrichEvent{RunID: r.id, Seq: seq, Agent: agent, Kind: kind, Payload: b, At: time.Now().UTC().Format(time.RFC3339)}
	for ch := range r.subs {
		select {
		case ch <- ev:
		default: // slow subscriber; they will re-sync from the store
		}
	}
	r.mu.Unlock()
	_ = o.Store.AppendEnrichEvent(r.id, seq, agent, kind, b)
}

// LogToolCall records a toolbox invocation on behalf of a scout.
func (o *Orchestrator) LogToolCall(runID, agent, tool string, args []string, result any, callErr error) {
	o.mu.Lock()
	r, ok := o.runs[runID]
	o.mu.Unlock()
	if !ok {
		return
	}
	payload := map[string]any{"tool": tool, "args": args}
	if callErr != nil {
		payload["error"] = callErr.Error()
	} else if b, err := json.Marshal(result); err == nil {
		payload["result"] = json.RawMessage(capRaw(b, 2000))
	}
	o.emit(r, agent, "toolbox", payload)
}

// Start accepts a deep run for an issue. It executes immediately if the pool
// has a free slot and otherwise waits its turn; the returned Placement says
// which happened.
func (o *Orchestrator) Start(issue store.IssueRow, settings store.EnrichSettings) (Placement, error) {
	id := "run_" + randHex(8)
	sourcesJSON, _ := json.Marshal(settings.Sources)
	if err := o.Store.CreateEnrichRun(store.EnrichRun{
		ID: id, IssueID: issue.ID, IssueIdentifier: issue.Identifier,
		Mode: "deep", Status: "queued", SourcesJSON: string(sourcesJSON),
	}); err != nil {
		return Placement{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &run{id: id, token: randHex(16), subs: map[chan store.EnrichEvent]struct{}{}, cancel: cancel}
	o.mu.Lock()
	o.runs[id] = r
	o.queue = append(o.queue, &pending{r: r, ctx: ctx, issue: issue, settings: settings})
	o.mu.Unlock()

	if pos := o.drain(id); pos > 0 {
		return Placement{ID: id, Status: "queued", Position: pos}, nil
	}
	return Placement{ID: id, Status: "running"}, nil
}

// drain launches as many waiting runs as the pool has room for, then
// re-announces the place in line of everyone still queued. It returns the
// 1-based position of runID, or 0 when that run is no longer waiting.
//
// Every store write and event emit happens after the lock is released: emit
// takes the run's own mutex and hits sqlite.
func (o *Orchestrator) drain(runID string) int {
	o.mu.Lock()
	ready := o.startReadyLocked()
	inLine := o.waitingLocked()
	o.mu.Unlock()

	for _, p := range ready {
		if err := o.Store.StartEnrichRun(p.r.id); err != nil {
			fmt.Printf("deep: mark %s running: %v\n", p.r.id, err)
		}
		go o.runPooled(p)
	}
	pos := 0
	for _, w := range inLine {
		if w.r.id == runID {
			pos = w.pos
		}
		o.announce(w)
	}
	return pos
}

// startReadyLocked pops as many runs off the queue as there are free slots
// and hands them back for the caller to launch outside the lock.
func (o *Orchestrator) startReadyLocked() []*pending {
	var ready []*pending
	for o.active < o.maxConcurrent() && len(o.queue) > 0 {
		p := o.queue[0]
		o.queue = o.queue[1:]
		o.active++
		ready = append(ready, p)
	}
	return ready
}

// waitingLocked snapshots the still-queued runs with their 1-based positions.
func (o *Orchestrator) waitingLocked() []waiting {
	out := make([]waiting, 0, len(o.queue))
	for i, p := range o.queue {
		out = append(out, waiting{r: p.r, issue: p.issue.Identifier, pos: i + 1})
	}
	return out
}

// announce emits a queued status event, but only when the run's place in line
// actually changed — a drain runs on every start and every completion.
func (o *Orchestrator) announce(w waiting) {
	w.r.mu.Lock()
	moved := w.r.queuePos != w.pos
	w.r.queuePos = w.pos
	w.r.mu.Unlock()
	if !moved {
		return
	}
	o.emit(w.r, "orchestrator", "status", map[string]any{
		"state": "queued", "issue": w.issue, "position": w.pos,
	})
}

// runPooled executes one run and frees its slot, which drains the next.
func (o *Orchestrator) runPooled(p *pending) {
	defer func() {
		o.mu.Lock()
		o.active--
		o.mu.Unlock()
		o.drain("")
	}()
	o.execute(p.ctx, p.r, p.issue, p.settings)
}

type scoutResult struct {
	Name    string          `json:"name"`
	Status  string          `json:"status"` // done | error | skipped
	Output  json.RawMessage `json:"output,omitempty"`
	Error   string          `json:"error,omitempty"`
	Elapsed string          `json:"elapsed"`
}

func (o *Orchestrator) execute(ctx context.Context, r *run, issue store.IssueRow, settings store.EnrichSettings) {
	defer func() {
		o.mu.Lock()
		r.done = true
		o.mu.Unlock()
		// Keep run in memory briefly for late SSE attach, then drop.
		time.AfterFunc(10*time.Minute, func() {
			o.mu.Lock()
			delete(o.runs, r.id)
			o.mu.Unlock()
		})
	}()

	avail := o.Toolbox.Probe(settings)
	scouts := o.enabledScouts(settings, avail)
	names := make([]string, 0, len(scouts))
	for _, s := range scouts {
		names = append(names, s.Name)
	}
	o.emit(r, "orchestrator", "status", map[string]any{
		"state": "started", "issue": issue.Identifier, "scouts": names,
	})
	if len(scouts) == 0 {
		o.finish(r, issue, "", fmt.Errorf("no enabled+available sources; open Settings"))
		return
	}

	issueCtx := issueContext(issue, o.commentsFor(issue.ID))

	var wg sync.WaitGroup
	results := make([]scoutResult, len(scouts))
	for i, sc := range scouts {
		wg.Go(func() {
			start := time.Now()
			o.emit(r, sc.Name, "status", map[string]any{"state": "running"})
			prompt := sc.Prompt(issueCtx)
			o.emit(r, sc.Name, "prompt", map[string]any{"prompt": prompt})
			opts := streamOpts{
				Command: o.Command, Model: o.Model, Prompt: prompt,
				Timeout: o.timeout(),
			}
			if sc.Name == "repo" {
				dirs := make([]string, 0, len(settings.Sources.Repo.Paths))
				for _, p := range settings.Sources.Repo.Paths {
					dirs = append(dirs, expand(p))
				}
				opts.AllowedTools = []string{"Read", "Grep", "Glob"}
				opts.AddDirs = dirs
				if len(dirs) > 0 {
					opts.Dir = dirs[0]
				}
			} else {
				opts.AllowedTools = []string{"Bash(triage-tool:*)"}
				opts.Env = []string{
					"PATH=" + o.shimDir + ":" + os.Getenv("PATH"),
					"RT_TOOLBOX_URL=http://" + o.Addr + "/api/toolbox",
					"RT_RUN_TOKEN=" + r.token,
					"RT_AGENT=" + sc.Name,
				}
				scratch, err := os.MkdirTemp("", "rt-scout-")
				if err == nil {
					defer os.RemoveAll(scratch)
					opts.Dir = scratch
				}
			}
			final, usage, err := claudeStream(ctx, opts, func(kind string, payload any) {
				o.emit(r, sc.Name, kind, payload)
			})
			o.recordUsage(usage, r.id, issue.ID, sc.Name)
			res := scoutResult{Name: sc.Name, Elapsed: time.Since(start).Round(time.Second).String()}
			if err != nil {
				res.Status = "error"
				res.Error = err.Error()
				o.emit(r, sc.Name, "error", map[string]any{"error": err.Error()})
			} else {
				res.Status = "done"
				res.Output = extractJSON(final)
				o.emit(r, sc.Name, "result", map[string]any{"output": res.Output, "elapsed": res.Elapsed})
			}
			results[i] = res
		})
	}
	wg.Wait()

	// Synthesis: no tools, just the scout outputs.
	o.emit(r, "synthesis", "status", map[string]any{"state": "running"})
	resultsJSON, _ := json.MarshalIndent(results, "", " ")
	prompt := synthesisPrompt(issueCtx, string(resultsJSON))
	o.emit(r, "synthesis", "prompt", map[string]any{"prompt": prompt})
	final, usage, err := claudeStream(ctx, streamOpts{
		Command: o.Command, Model: o.Model, Prompt: prompt, Timeout: o.timeout(),
	}, func(kind string, payload any) {
		o.emit(r, "synthesis", kind, payload)
	})
	o.recordUsage(usage, r.id, issue.ID, "synthesis")
	if err != nil {
		o.finish(r, issue, "", err)
		return
	}
	report := extractJSON(final)
	if report == nil {
		o.finish(r, issue, "", fmt.Errorf("synthesis produced no JSON report"))
		return
	}
	// Stamp source statuses into the report for stable rendering.
	report = stampSources(report, results)
	o.finish(r, issue, string(report), nil)
}

// recordUsage stamps a call's accounting with the run, issue, and the agent
// that spent it, then stores it. Best-effort, like every other write on this
// path: losing a usage row must never fail a run.
func (o *Orchestrator) recordUsage(u store.TokenUsage, runID, issueID, agent string) {
	u.RunID, u.IssueID, u.Agent = runID, issueID, agent
	_ = o.Store.RecordTokenUsage(u)
}

func (o *Orchestrator) finish(r *run, issue store.IssueRow, reportJSON string, err error) {
	if err != nil {
		o.emit(r, "orchestrator", "error", map[string]any{"error": err.Error()})
		_ = o.Store.FinishEnrichRun(r.id, "error", "", err.Error())
		return
	}
	_ = o.Store.SaveEnrichmentReport(issue.ID, reportJSON)
	// Mirror headline fields onto the fast-enrichment row so card chips work.
	var rep struct {
		Verdict    string  `json:"verdict"`
		Summary    string  `json:"summary"`
		Reasoning  string  `json:"reasoning"`
		Confidence float64 `json:"confidence"`
	}
	if json.Unmarshal([]byte(reportJSON), &rep) == nil && rep.Summary != "" {
		_ = o.Store.SaveEnrichment(store.Enrichment{
			IssueID: issue.ID, Summary: rep.Summary, Verdict: rep.Verdict,
			Reasoning: rep.Reasoning, Confidence: rep.Confidence, Model: o.Model,
		})
		_ = o.Store.SaveEnrichmentReport(issue.ID, reportJSON)
	}
	o.emit(r, "orchestrator", "report", json.RawMessage(reportJSON))
	o.emit(r, "orchestrator", "status", map[string]any{"state": "done"})
	_ = o.Store.FinishEnrichRun(r.id, "done", reportJSON, "")
}

func (o *Orchestrator) commentsFor(issueID string) string {
	cached, _, err := o.Store.GetIssueContext(issueID)
	if err != nil || cached == "" {
		return ""
	}
	return truncateStr(cached, 4000)
}

var jsonBlockRe = regexp.MustCompile(`(?s)\{.*\}`)

// extractJSON pulls the outermost JSON object out of a model reply.
func extractJSON(text string) json.RawMessage {
	m := jsonBlockRe.FindString(text)
	if m == "" {
		return nil
	}
	var v any
	if err := json.Unmarshal([]byte(m), &v); err != nil {
		return nil
	}
	b, _ := json.Marshal(v)
	return b
}

func stampSources(report json.RawMessage, results []scoutResult) json.RawMessage {
	var m map[string]any
	if json.Unmarshal(report, &m) != nil {
		return report
	}
	src := map[string]any{}
	for _, res := range results {
		src[res.Name] = map[string]any{"status": res.Status, "elapsed": res.Elapsed, "error": res.Error}
	}
	m["sources"] = src
	m["schemaVersion"] = 1
	b, _ := json.Marshal(m)
	return b
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
