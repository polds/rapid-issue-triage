// Package update checks GitHub for a newer released version, on a timer, in
// the background.
//
// This is the only outbound request the app makes that is not to Linear or to
// the local `claude` binary, so it is deliberately narrow: one unauthenticated
// GET to the public releases endpoint, no request body, no identifiers, and
// nothing about the user's workspace. It sends the current version in the
// User-Agent because GitHub requires a User-Agent at all. `update_check:
// enabled: false` in the config turns it off outright, and a failure is only
// ever reported as status — never as a startup or request error.
//
// A leaf package: stdlib plus internal/version.
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/polds/rapid-issue-triage/internal/version"
)

const (
	// DefaultRepo is where this binary's releases are published.
	DefaultRepo = "polds/rapid-issue-triage"
	// DefaultInterval between background checks.
	DefaultInterval = 24 * time.Hour
	// MinInterval floors a user-configured interval. Nothing here justifies
	// asking GitHub more often, and the anonymous rate limit is 60/hour/IP.
	MinInterval = time.Hour
	// defaultFirstDelay keeps the first check out of the way of the first sync
	// and the browser launch.
	defaultFirstDelay = 20 * time.Second
	// maxBody caps the release JSON we are willing to read.
	maxBody = 1 << 20
	// requestTimeout for a single check.
	requestTimeout = 10 * time.Second

	defaultBaseURL = "https://api.github.com"
)

// repoPattern is `owner/name` and nothing else, so a config value can never
// steer the request at another path or host.
var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`)

// Status is the update state the UI renders. Its JSON tags are the frontend's
// contract (web/src/lib/types.ts).
type Status struct {
	// Enabled is false when the config turned the check off; the UI then shows
	// the version alone and offers no "check now".
	Enabled bool `json:"enabled"`
	// Checking is true while a check is in flight.
	Checking bool `json:"checking"`
	// Latest is the newest published release tag, once one has been seen.
	Latest string `json:"latest,omitempty"`
	// Available is true only when Latest parses as strictly newer than the
	// running version. A dev build is never out of date.
	Available bool `json:"available"`
	// ReleaseURL points at the release page for Latest.
	ReleaseURL string `json:"releaseUrl,omitempty"`
	// CheckedAt is RFC3339 UTC, empty until the first check completes.
	CheckedAt string `json:"checkedAt,omitempty"`
	// Error carries the last failure, cleared by the next success. A failed
	// check is informational: the app works exactly the same without it.
	Error string `json:"error,omitempty"`
}

// Options configures a Checker. Everything is optional but Info.
type Options struct {
	Info     version.Info
	Repo     string
	Interval time.Duration
	Enabled  bool
	// BaseURL overrides the GitHub API root. Tests set it; nothing else should.
	BaseURL string
	Client  *http.Client
}

type Checker struct {
	info     version.Info
	repo     string
	interval time.Duration
	// firstDelay is how long Run waits before its first check.
	firstDelay time.Duration
	baseURL    string
	client     *http.Client

	mu     sync.Mutex
	status Status
}

func New(o Options) *Checker {
	repo := o.Repo
	if !repoPattern.MatchString(repo) {
		if repo != "" {
			log.Printf("update: ignoring malformed update_check.repo %q", repo)
		}
		repo = DefaultRepo
	}
	interval := o.Interval
	if interval <= 0 {
		interval = DefaultInterval
	}
	if interval < MinInterval {
		interval = MinInterval
	}
	baseURL := o.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	client := o.Client
	if client == nil {
		client = &http.Client{Timeout: requestTimeout}
	}
	return &Checker{
		info: o.Info, repo: repo, interval: interval, firstDelay: defaultFirstDelay,
		baseURL: baseURL, client: client,
		status: Status{Enabled: o.Enabled},
	}
}

// Info is the build stamp this checker compares against.
func (c *Checker) Info() version.Info { return c.info }

// Status returns a snapshot. Safe from any goroutine.
func (c *Checker) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status
}

// Run checks shortly after startup and then on the configured interval, until
// ctx is done. It returns immediately when checking is disabled.
func (c *Checker) Run(ctx context.Context) {
	if !c.Status().Enabled {
		return
	}
	t := time.NewTimer(c.firstDelay)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.Check(ctx)
			t.Reset(c.interval)
		}
	}
}

// Check performs one check and returns the resulting status. A check already
// in flight is not duplicated: the caller gets the current status instead.
// Disabled checkers never make a request.
func (c *Checker) Check(ctx context.Context) Status {
	c.mu.Lock()
	if !c.status.Enabled || c.status.Checking {
		st := c.status
		c.mu.Unlock()
		return st
	}
	c.status.Checking = true
	c.mu.Unlock()

	latest, url, err := c.fetchLatest(ctx)

	c.mu.Lock()
	defer c.mu.Unlock()
	c.status.Checking = false
	c.status.CheckedAt = time.Now().UTC().Format(time.RFC3339)
	if err != nil {
		// Keep the last known good result visible; the error explains why it
		// may be out of date.
		c.status.Error = err.Error()
		return c.status
	}
	c.status.Error = ""
	c.status.Latest = latest
	c.status.ReleaseURL = url
	c.status.Available = version.IsNewer(latest, c.info.Version)
	return c.status
}

// release is the slice of GitHub's release payload we use.
type release struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

// errNoReleases means the repository has published none yet — expected on a
// fork, and not worth showing as a failure.
var errNoReleases = errors.New("no releases published yet")

func (c *Checker) fetchLatest(ctx context.Context) (tag, url string, err error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	endpoint := c.baseURL + "/repos/" + c.repo + "/releases/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "rapid-issue-triage/"+c.info.Version)

	resp, err := c.client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("contact github: %w", err)
	}
	defer resp.Body.Close()
	if err := statusErr(resp); err != nil {
		if errors.Is(err, errNoReleases) {
			return "", c.releasesURL(), nil
		}
		return "", "", err
	}
	var rel release
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&rel); err != nil {
		return "", "", fmt.Errorf("decode release: %w", err)
	}
	if rel.TagName == "" {
		return "", "", errors.New("github returned a release with no tag")
	}
	if rel.HTMLURL == "" {
		rel.HTMLURL = c.releasesURL()
	}
	return rel.TagName, rel.HTMLURL, nil
}

func (c *Checker) releasesURL() string {
	return "https://github.com/" + c.repo + "/releases/latest"
}

// statusErr turns a non-200 into the message the Settings page shows. The
// rate-limit case is called out because it is the one a user can wait out.
func statusErr(resp *http.Response) error {
	switch resp.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusNotFound:
		return errNoReleases
	case http.StatusForbidden, http.StatusTooManyRequests:
		return errors.New("github rate limit reached; will retry on the next check")
	default:
		return fmt.Errorf("github returned %s", resp.Status)
	}
}
