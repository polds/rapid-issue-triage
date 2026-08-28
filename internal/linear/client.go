// Package linear is a minimal GraphQL client for the Linear API, covering the
// metadata + issue queries and the issueUpdate mutation this tool needs.
package linear

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

const endpoint = "https://api.linear.app/graphql"

type Client struct {
	mu     sync.RWMutex
	apiKey string
	http   *http.Client
}

func New(apiKey string) *Client {
	return &Client{apiKey: apiKey, http: &http.Client{Timeout: 30 * time.Second}}
}

// SetAPIKey replaces the key used for subsequent requests (Settings save).
func (c *Client) SetAPIKey(key string) {
	c.mu.Lock()
	c.apiKey = key
	c.mu.Unlock()
}

type gqlError struct {
	Message string `json:"message"`
}

// Do executes a GraphQL request and unmarshals the "data" object into out.
func (c *Client) Do(ctx context.Context, query string, vars map[string]any, out any) error {
	body, err := json.Marshal(map[string]any{"query": query, "variables": vars})
	if err != nil {
		return err
	}
	var lastErr error
	for attempt := range 3 {
		if attempt > 0 {
			if err := waitAttempt(ctx, attempt); err != nil {
				return err
			}
		}
		retry, err := c.roundTrip(ctx, body, out)
		if err != nil && !retry {
			return err
		}
		if err == nil {
			return nil
		}
		lastErr = err
	}
	return lastErr
}

func waitAttempt(ctx context.Context, attempt int) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Duration(attempt) * 2 * time.Second):
		return nil
	}
}

func (c *Client) roundTrip(ctx context.Context, body []byte, out any) (retry bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	c.mu.RLock()
	key := c.apiKey
	c.mu.RUnlock()
	// Personal API keys are passed directly, without a Bearer prefix.
	req.Header.Set("Authorization", key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return true, err
	}
	raw, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return true, err
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return true, fmt.Errorf("linear: http %d: %s", resp.StatusCode, truncate(raw, 300))
	}
	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []gqlError      `json:"errors"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return false, fmt.Errorf("linear: decode response (http %d): %w: %s", resp.StatusCode, err, truncate(raw, 300))
	}
	if len(envelope.Errors) > 0 {
		return false, fmt.Errorf("linear: %s", envelope.Errors[0].Message)
	}
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("linear: http %d: %s", resp.StatusCode, truncate(raw, 300))
	}
	if out != nil {
		if err := json.Unmarshal(envelope.Data, out); err != nil {
			return false, fmt.Errorf("linear: decode data: %w", err)
		}
	}
	return false, nil
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "…"
	}
	return string(b)
}
