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
	"time"
)

const endpoint = "https://api.linear.app/graphql"

type Client struct {
	apiKey string
	http   *http.Client
}

func New(apiKey string) *Client {
	return &Client{apiKey: apiKey, http: &http.Client{Timeout: 30 * time.Second}}
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
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return err
		}
		// Personal API keys are passed directly, without a Bearer prefix.
		req.Header.Set("Authorization", c.apiKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		raw, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("linear: http %d: %s", resp.StatusCode, truncate(raw, 300))
			continue
		}
		var envelope struct {
			Data   json.RawMessage `json:"data"`
			Errors []gqlError      `json:"errors"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return fmt.Errorf("linear: decode response (http %d): %w: %s", resp.StatusCode, err, truncate(raw, 300))
		}
		if len(envelope.Errors) > 0 {
			return fmt.Errorf("linear: %s", envelope.Errors[0].Message)
		}
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("linear: http %d: %s", resp.StatusCode, truncate(raw, 300))
		}
		if out != nil {
			if err := json.Unmarshal(envelope.Data, out); err != nil {
				return fmt.Errorf("linear: decode data: %w", err)
			}
		}
		return nil
	}
	return lastErr
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "…"
	}
	return string(b)
}
