package deep

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// claudeStream runs `claude -p --output-format stream-json --verbose` and
// forwards every assistant thought, tool call, and tool result to emit.
// Returns the final result text.
type streamOpts struct {
	Command      string
	Model        string
	Prompt       string
	AllowedTools []string
	AddDirs      []string
	Dir          string
	Env          []string // extra environment
	Timeout      time.Duration
}

func claudeStream(ctx context.Context, o streamOpts, emit func(kind string, payload any)) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, o.Timeout)
	defer cancel()

	args := []string{"-p", "--output-format", "stream-json", "--verbose"}
	if o.Model != "" {
		args = append(args, "--model", o.Model)
	}
	if len(o.AllowedTools) > 0 {
		args = append(args, "--allowedTools", strings.Join(o.AllowedTools, ","))
	}
	for _, d := range o.AddDirs {
		args = append(args, "--add-dir", d)
	}
	cmd := exec.CommandContext(ctx, o.Command, args...)
	cmd.Stdin = strings.NewReader(o.Prompt)
	if o.Dir != "" {
		cmd.Dir = o.Dir
	}
	cmd.Env = append(os.Environ(), o.Env...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}

	final := ""
	isError := false
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1024*1024), 8*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		var msg struct {
			Type    string `json:"type"`
			Subtype string `json:"subtype"`
			Result  string `json:"result"`
			IsError bool   `json:"is_error"`
			Message struct {
				Content []json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(line, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "assistant":
			for _, raw := range msg.Message.Content {
				var block struct {
					Type  string          `json:"type"`
					Text  string          `json:"text"`
					Name  string          `json:"name"`
					Input json.RawMessage `json:"input"`
				}
				if json.Unmarshal(raw, &block) != nil {
					continue
				}
				switch block.Type {
				case "text":
					if t := strings.TrimSpace(block.Text); t != "" {
						emit("thought", map[string]any{"text": t})
					}
				case "tool_use":
					emit("tool_call", map[string]any{
						"tool":  block.Name,
						"input": json.RawMessage(capRaw(block.Input, 2000)),
					})
				}
			}
		case "user":
			for _, raw := range msg.Message.Content {
				var block struct {
					Type    string          `json:"type"`
					Content json.RawMessage `json:"content"`
				}
				if json.Unmarshal(raw, &block) != nil || block.Type != "tool_result" {
					continue
				}
				emit("tool_result", map[string]any{
					"result": json.RawMessage(capRaw(block.Content, 2000)),
				})
			}
		case "result":
			final = msg.Result
			isError = msg.IsError
		}
	}
	scanErr := sc.Err()
	waitErr := cmd.Wait()
	if isError {
		return "", fmt.Errorf("claude reported error: %s", truncateStr(final, 400))
	}
	if waitErr != nil {
		return "", fmt.Errorf("claude exited: %v: %s", waitErr, truncateStr(stderr.String(), 400))
	}
	if scanErr != nil {
		return "", scanErr
	}
	if final == "" {
		return "", fmt.Errorf("claude produced no result")
	}
	return final, nil
}

// capRaw truncates raw JSON payloads for event logs, keeping them valid JSON
// by re-wrapping oversized ones as a string.
func capRaw(raw json.RawMessage, n int) []byte {
	if len(raw) == 0 {
		return []byte("null")
	}
	if len(raw) <= n {
		return raw
	}
	b, _ := json.Marshal(string(raw[:n]) + "…")
	return b
}
