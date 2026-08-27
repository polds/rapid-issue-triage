// Package syncer indexes Linear metadata and untriaged issues into sqlite in
// the background. The UI always serves from sqlite (possibly stale) while a
// refresh runs.
package syncer

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/polds/rapid-issue-triage/internal/linear"
	"github.com/polds/rapid-issue-triage/internal/store"
)

type Status struct {
	State        string `json:"state"` // idle | syncing | error
	LastSyncedAt string `json:"lastSyncedAt,omitempty"`
	LastError    string `json:"lastError,omitempty"`
	IssueCount   int    `json:"issueCount"`
	Stale        bool   `json:"stale"`
	// Reindexing is true when the active index filter differs from the one
	// the last completed sync used — the index is being rebuilt.
	Reindexing bool `json:"reindexing"`
}

type Syncer struct {
	client   *linear.Client
	store    *store.Store
	filter   map[string]any
	interval time.Duration
	pageSize int

	mu      sync.Mutex
	syncing bool
	lastErr string
	kick    chan struct{}
}

func New(client *linear.Client, st *store.Store, filter map[string]any, interval time.Duration, pageSize int) *Syncer {
	return &Syncer{
		client: client, store: st, filter: filter,
		interval: interval, pageSize: pageSize,
		kick: make(chan struct{}, 1),
	}
}

// Run loops forever: immediate sync at startup, then interval or manual kicks.
func (s *Syncer) Run(ctx context.Context) {
	s.doSync(ctx)
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.doSync(ctx)
		case <-s.kick:
			s.doSync(ctx)
		}
	}
}

// Kick requests an immediate refresh (deduped while one is pending).
func (s *Syncer) Kick() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

func (s *Syncer) Status() Status {
	s.mu.Lock()
	syncing, lastErr := s.syncing, s.lastErr
	s.mu.Unlock()
	st := Status{State: "idle", LastError: lastErr}
	if syncing {
		st.State = "syncing"
	} else if lastErr != "" {
		st.State = "error"
	}
	if at, err := s.store.GetMeta("last_synced_at"); err == nil && at != "" {
		st.LastSyncedAt = at
		if ts, err := time.Parse(time.RFC3339, at); err == nil {
			st.Stale = time.Since(ts) > 2*s.interval
		}
	} else {
		st.Stale = true
	}
	st.IssueCount, _ = s.store.QueueCount(store.QueueFilter{})
	active, _ := json.Marshal(s.ActiveFilter())
	last, _ := s.store.GetMeta("last_sync_filter")
	st.Reindexing = last != "" && last != string(active) || (last == "" && st.LastSyncedAt == "")
	return st
}

// ActiveFilter returns the index filter in effect: the DB-stored override if
// present, else the config default.
func (s *Syncer) ActiveFilter() map[string]any {
	if raw, err := s.store.GetMeta("active_sync_filter"); err == nil && raw != "" {
		var f map[string]any
		if json.Unmarshal([]byte(raw), &f) == nil && len(f) > 0 {
			return f
		}
	}
	return s.filter
}

// DefaultFilter returns the config-supplied filter.
func (s *Syncer) DefaultFilter() map[string]any { return s.filter }

func (s *Syncer) doSync(ctx context.Context) {
	s.mu.Lock()
	if s.syncing {
		s.mu.Unlock()
		return
	}
	s.syncing = true
	s.mu.Unlock()
	err := s.syncOnce(ctx)
	s.mu.Lock()
	s.syncing = false
	if err != nil {
		s.lastErr = err.Error()
		log.Printf("sync: %v", err)
	} else {
		s.lastErr = ""
	}
	s.mu.Unlock()
}

func (s *Syncer) syncOnce(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	start := time.Now()

	// Generation number marks rows seen this pass; leftovers get pruned.
	genStr, _ := s.store.GetMeta("sync_gen")
	gen, _ := strconv.ParseInt(genStr, 10, 64)
	gen++

	// Resolve the index filter BEFORE opening the transaction: the store runs
	// on a single sqlite connection, so any s.db read inside the tx deadlocks.
	filter := s.ActiveFilter()

	// Metadata first.
	viewer, err := s.client.Viewer(ctx)
	if err != nil {
		return err
	}
	teams, err := s.client.Teams(ctx)
	if err != nil {
		return err
	}
	states, err := s.client.WorkflowStates(ctx)
	if err != nil {
		return err
	}
	labels, err := s.client.Labels(ctx)
	if err != nil {
		return err
	}
	projects, err := s.client.Projects(ctx)
	if err != nil {
		return err
	}
	cycles, err := s.client.Cycles(ctx)
	if err != nil {
		log.Printf("sync: cycles fetch failed (%v); continuing without cycles", err)
		cycles = nil
	}
	users, err := s.client.Users(ctx)
	if err != nil {
		return err
	}

	tx, err := s.store.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	teamRows := make([][]any, 0, len(teams))
	for _, t := range teams {
		teamRows = append(teamRows, []any{t.ID, t.Key, t.Name})
	}
	if err := s.store.ReplaceTeams(tx, teamRows); err != nil {
		return err
	}
	stateRows := make([][]any, 0, len(states))
	for _, w := range states {
		stateRows = append(stateRows, []any{w.ID, refID(w.Team), w.Name, w.Type, w.Color, w.Position})
	}
	if err := s.store.ReplaceStates(tx, stateRows); err != nil {
		return err
	}
	labelRows := make([][]any, 0, len(labels))
	for _, l := range labels {
		isGroup := 0
		if l.IsGroup {
			isGroup = 1
		}
		labelRows = append(labelRows, []any{l.ID, refID(l.Team), l.Name, l.Color, isGroup})
	}
	if err := s.store.ReplaceLabels(tx, labelRows); err != nil {
		return err
	}
	projRows := make([][]any, 0, len(projects))
	for _, p := range projects {
		projRows = append(projRows, []any{p.ID, p.Name, p.State})
	}
	if err := s.store.ReplaceProjects(tx, projRows); err != nil {
		return err
	}
	cycleRows := make([][]any, 0, len(cycles))
	for _, c := range cycles {
		cycleRows = append(cycleRows, []any{c.ID, refID(c.Team), c.Number, c.Name, c.StartsAt, c.EndsAt})
	}
	if err := s.store.ReplaceCycles(tx, cycleRows); err != nil {
		return err
	}
	userRows := make([][]any, 0, len(users))
	for _, u := range users {
		isMe := 0
		if u.ID == viewer.ID {
			isMe = 1
		}
		userRows = append(userRows, []any{u.ID, u.Name, u.DisplayName, u.Email, isMe})
	}
	if err := s.store.ReplaceUsers(tx, userRows); err != nil {
		return err
	}

	// Issues matching the untriaged filter.
	total := 0
	err = s.client.Issues(ctx, filter, s.pageSize, func(page []linear.Issue) error {
		for _, is := range page {
			if err := s.store.UpsertIssue(tx, gen, toRow(is)); err != nil {
				return err
			}
			total++
		}
		return nil
	})
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	pruned, err := s.store.PruneStale(gen)
	if err != nil {
		return err
	}
	if err := s.store.SetMeta("sync_gen", strconv.FormatInt(gen, 10)); err != nil {
		return err
	}
	if err := s.store.SetMeta("last_synced_at", time.Now().UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	fj, _ := json.Marshal(filter)
	if err := s.store.SetMeta("last_sync_filter", string(fj)); err != nil {
		return err
	}
	log.Printf("sync: indexed %d issues (pruned %d) in %s", total, pruned, time.Since(start).Round(time.Millisecond))
	return nil
}

func refID(r *linear.Ref) any {
	if r == nil {
		return nil
	}
	return r.ID
}

// ToRow converts a Linear issue into the local row shape.
func toRow(is linear.Issue) store.IssueRow {
	r := store.IssueRow{
		Labels: []store.LabelChip{},
		ID: is.ID, Identifier: is.Identifier, Title: is.Title, Description: is.Description,
		CreatorName: creatorName(is), Priority: int(is.Priority), Estimate: is.Estimate,
		URL: is.URL, CreatedAt: is.CreatedAt, UpdatedAt: is.UpdatedAt,
	}
	if is.Team != nil {
		r.TeamID = is.Team.ID
	}
	if is.State != nil {
		r.StateID = is.State.ID
	}
	if is.Assignee != nil {
		r.AssigneeID = is.Assignee.ID
	}
	if is.Project != nil {
		r.ProjectID = is.Project.ID
	}
	if is.Cycle != nil {
		r.CycleID = is.Cycle.ID
	}
	for _, l := range is.Labels.Nodes {
		r.Labels = append(r.Labels, store.LabelChip{ID: l.ID, Name: l.Name, Color: l.Color})
	}
	return r
}

// ToRow is exported for the server to reuse after issueUpdate responses.
func ToRow(is linear.Issue) store.IssueRow { return toRow(is) }

func creatorName(is linear.Issue) string {
	if is.Creator == nil {
		return ""
	}
	if is.Creator.DisplayName != "" {
		return is.Creator.DisplayName
	}
	return is.Creator.Name
}
