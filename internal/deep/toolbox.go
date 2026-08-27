// Package deep implements deep AI enrichment: a fanout of read-only scout
// agents over enabled data sources, orchestrated in Go, synthesized into a
// fixed-schema report, with every step logged.
//
// Scouts never hold credentials. All external access flows through the
// Toolbox: the agent runs `triage-tool <tool> <args>`, a shim that POSTs to
// this server, which executes a read-only implementation and logs the call.
package deep

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/polds/rapid-issue-triage/internal/linear"
	"github.com/polds/rapid-issue-triage/internal/store"
)

type Toolbox struct {
	Linear *linear.Client
	Store  *store.Store
}

// Availability reports which sources can actually run on this machine.
type Availability struct {
	Repo    SourceAvail `json:"repo"`
	GitHub  SourceAvail `json:"github"`
	Linear  SourceAvail `json:"linear"`
	Datadog SourceAvail `json:"datadog"`
	Gcloud  SourceAvail `json:"gcloud"`
}

type SourceAvail struct {
	Available bool   `json:"available"`
	Detail    string `json:"detail"`
}

func (t *Toolbox) Probe(settings store.EnrichSettings) Availability {
	var a Availability
	// repo: paths must exist
	if len(settings.Sources.Repo.Paths) == 0 {
		a.Repo = SourceAvail{false, "no directories configured"}
	} else {
		missing := []string{}
		for _, p := range settings.Sources.Repo.Paths {
			if st, err := os.Stat(expand(p)); err != nil || !st.IsDir() {
				missing = append(missing, p)
			}
		}
		if len(missing) > 0 {
			a.Repo = SourceAvail{false, "missing: " + strings.Join(missing, ", ")}
		} else {
			a.Repo = SourceAvail{true, fmt.Sprintf("%d directories", len(settings.Sources.Repo.Paths))}
		}
	}
	// github: gh present + authed
	if _, err := exec.LookPath("gh"); err != nil {
		a.GitHub = SourceAvail{false, "gh not in PATH"}
	} else if err := exec.Command("gh", "auth", "status").Run(); err != nil {
		a.GitHub = SourceAvail{false, "gh not authenticated"}
	} else {
		a.GitHub = SourceAvail{true, "gh authenticated"}
	}
	a.Linear = SourceAvail{true, "uses this app's API key"}
	if os.Getenv("DD_API_KEY") != "" && os.Getenv("DD_APP_KEY") != "" {
		a.Datadog = SourceAvail{true, "DD_API_KEY/DD_APP_KEY set"}
	} else {
		a.Datadog = SourceAvail{false, "set DD_API_KEY and DD_APP_KEY in the environment"}
	}
	if _, err := exec.LookPath("gcloud"); err != nil {
		a.Gcloud = SourceAvail{false, "gcloud not in PATH"}
	} else {
		a.Gcloud = SourceAvail{true, "read-only verbs: list/describe/get-iam-policy/logging read"}
	}
	return a
}

func expand(p string) string {
	if strings.HasPrefix(p, "~/") {
		home, _ := os.UserHomeDir()
		return home + p[1:]
	}
	return p
}

// Call executes one read-only tool invocation. tool is "<source>.<verb>".
func (t *Toolbox) Call(ctx context.Context, tool string, args []string) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	switch tool {
	case "linear.search":
		return t.linearSearch(ctx, strings.Join(args, " "))
	case "linear.issue":
		if len(args) < 1 {
			return nil, fmt.Errorf("usage: linear.issue <identifier>")
		}
		return t.linearIssue(ctx, args[0])
	case "github.search-prs":
		return t.gh(ctx, "search", "prs", strings.Join(args, " "),
			"--limit", "10", "--json", "title,number,repository,state,url,closedAt,updatedAt")
	case "github.search-code":
		return t.gh(ctx, "search", "code", strings.Join(args, " "),
			"--limit", "10", "--json", "path,repository,url")
	case "github.pr":
		if len(args) < 2 {
			return nil, fmt.Errorf("usage: github.pr <owner/repo> <number>")
		}
		return t.gh(ctx, "pr", "view", args[1], "-R", args[0],
			"--json", "title,state,url,mergedAt,closedAt,body,author")
	case "datadog.logs":
		hours := 168
		if len(args) > 1 {
			if h, err := strconv.Atoi(args[len(args)-1]); err == nil {
				hours = h
				args = args[:len(args)-1]
			}
		}
		return t.datadogLogs(ctx, strings.Join(args, " "), hours)
	case "datadog.monitors":
		return t.datadogMonitors(ctx, strings.Join(args, " "))
	case "gcloud.run":
		return t.gcloudRun(ctx, args)
	default:
		return nil, fmt.Errorf("unknown tool %q", tool)
	}
}

func (t *Toolbox) linearSearch(ctx context.Context, term string) (any, error) {
	term = strings.TrimSpace(term)
	if term == "" {
		return nil, fmt.Errorf("empty search term")
	}
	var filter map[string]any
	if regexp.MustCompile(`^[A-Za-z]+-\d+$`).MatchString(term) {
		return t.linearIssue(ctx, term)
	}
	filter = map[string]any{"title": map[string]any{"containsIgnoreCase": term}}
	type hit struct {
		ID         string `json:"id"`
		Identifier string `json:"identifier"`
		Title      string `json:"title"`
		State      string `json:"state"`
		UpdatedAt  string `json:"updatedAt"`
		URL        string `json:"url"`
	}
	out := []hit{}
	err := t.Linear.Issues(ctx, filter, 15, func(page []linear.Issue) error {
		for _, is := range page {
			stateName := ""
			if is.State != nil {
				if n, err := t.Store.StateType(is.State.ID); err == nil {
					stateName = n
				}
			}
			out = append(out, hit{is.ID, is.Identifier, is.Title, stateName, is.UpdatedAt, is.URL})
		}
		return fmt.Errorf("stop") // one page of 15 is enough
	})
	if err != nil && err.Error() != "stop" {
		return nil, err
	}
	return map[string]any{"issues": out}, nil
}

func (t *Toolbox) linearIssue(ctx context.Context, identifier string) (any, error) {
	q := `query($id: String!) { issue(id: $id) {
	  id identifier title description url createdAt updatedAt
	  state { name type } assignee { displayName }
	  comments(first: 20) { nodes { body createdAt user { displayName } } }
	} }`
	var out struct {
		Issue map[string]any `json:"issue"`
	}
	if err := t.Linear.Do(ctx, q, map[string]any{"id": identifier}, &out); err != nil {
		return nil, err
	}
	if d, ok := out.Issue["description"].(string); ok && len(d) > 4000 {
		out.Issue["description"] = d[:4000] + "…"
	}
	return out.Issue, nil
}

// gh runs a fixed read-only gh subcommand.
func (t *Toolbox) gh(ctx context.Context, args ...string) (any, error) {
	cmd := exec.CommandContext(ctx, "gh", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("gh %s: %s", strings.Join(args[:2], " "), firstLine(stderr.String()))
	}
	var v any
	if err := json.Unmarshal(stdout.Bytes(), &v); err != nil {
		return map[string]any{"output": truncateStr(stdout.String(), 4000)}, nil
	}
	return truncateJSON(v), nil
}

func (t *Toolbox) ddSite() string {
	if s := t.Store.GetEnrichSettings().Sources.Datadog.Site; s != "" {
		return s
	}
	if s := os.Getenv("DD_SITE"); s != "" {
		return s
	}
	return "datadoghq.com"
}

func (t *Toolbox) datadogLogs(ctx context.Context, query string, hours int) (any, error) {
	body, _ := json.Marshal(map[string]any{
		"filter": map[string]any{
			"query": query,
			"from":  fmt.Sprintf("now-%dh", hours),
			"to":    "now",
		},
		"page": map[string]any{"limit": 10},
	})
	req, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("https://api.%s/api/v2/logs/events/search", t.ddSite()), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("DD-API-KEY", os.Getenv("DD_API_KEY"))
	req.Header.Set("DD-APPLICATION-KEY", os.Getenv("DD_APP_KEY"))
	req.Header.Set("Content-Type", "application/json")
	return doJSON(req)
}

func (t *Toolbox) datadogMonitors(ctx context.Context, query string) (any, error) {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://api.%s/api/v1/monitor/search?query=%s", t.ddSite(), strings.ReplaceAll(query, " ", "%20")), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("DD-API-KEY", os.Getenv("DD_API_KEY"))
	req.Header.Set("DD-APPLICATION-KEY", os.Getenv("DD_APP_KEY"))
	return doJSON(req)
}

var gcloudDenied = regexp.MustCompile(`^(create|delete|update|set|add|remove|apply|deploy|patch|import|export|start|stop|restart|resume|suspend|move|copy|attach|detach|enable|disable|reset|rollback|promote|scale|ssh|login)`)
var gcloudAllowed = map[string]bool{"list": true, "describe": true, "get-iam-policy": true, "read": true, "tail": false}

// gcloudRun executes gcloud restricted to read verbs.
func (t *Toolbox) gcloudRun(ctx context.Context, args []string) (any, error) {
	hasAllowed := false
	for _, a := range args {
		if strings.HasPrefix(a, "-") {
			continue
		}
		if gcloudAllowed[a] {
			hasAllowed = true
		}
		if gcloudDenied.MatchString(a) {
			return nil, fmt.Errorf("gcloud verb %q is not allowed (read-only access)", a)
		}
	}
	if !hasAllowed {
		return nil, fmt.Errorf("gcloud call must use a read verb: list, describe, get-iam-policy, or read")
	}
	args = append(args, "--format=json")
	cmd := exec.CommandContext(ctx, "gcloud", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("gcloud: %s", firstLine(stderr.String()))
	}
	var v any
	if err := json.Unmarshal(stdout.Bytes(), &v); err != nil {
		return map[string]any{"output": truncateStr(stdout.String(), 4000)}, nil
	}
	return truncateJSON(v), nil
}

func doJSON(req *http.Request) (any, error) {
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var v any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		b, _ := json.Marshal(v)
		return nil, fmt.Errorf("datadog http %d: %s", resp.StatusCode, truncateStr(string(b), 300))
	}
	return truncateJSON(v), nil
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i > 0 {
		return s[:i]
	}
	return s
}

func truncateStr(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// truncateJSON caps the serialized size of tool results fed back to agents.
func truncateJSON(v any) any {
	b, err := json.Marshal(v)
	if err != nil || len(b) <= 12000 {
		return v
	}
	return map[string]any{"truncated": true, "partial": string(b[:12000])}
}
