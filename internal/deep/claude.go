package deep

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

	cmd := exec.CommandContext(ctx, o.Command, streamArgs(o)...)
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

	final, isError, scanErr := consumeClaudeStream(stdout, emit)
	waitErr := cmd.Wait()
	if isError {
		return "", fmt.Errorf("claude reported error: %s", truncateStr(final, 400))
	}
	if waitErr != nil {
		return "", fmt.Errorf("claude exited: %w: %s", waitErr, truncateStr(stderr.String(), 400))
	}
	if scanErr != nil {
		return "", scanErr
	}
	if final == "" {
		return "", fmt.Errorf("claude produced no result")
	}
	return final, nil
}

func streamArgs(o streamOpts) []string {
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
	return args
}

func consumeClaudeStream(stdout io.Reader, emit func(kind string, payload any)) (final string, isError bool, err error) {
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1024*1024), 8*1024*1024)
	for sc.Scan() {
		final, isError = applyClaudeLine(sc.Bytes(), emit, final, isError)
	}
	return final, isError, sc.Err()
}

func applyClaudeLine(line []byte, emit func(kind string, payload any), final string, isError bool) (string, bool) {
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
		return final, isError
	}
	switch msg.Type {
	case "assistant":
		emitAssistantBlocks(msg.Message.Content, emit)
	case "user":
		emitToolResults(msg.Message.Content, emit)
	case "result":
		return msg.Result, msg.IsError
	}
	return final, isError
}

func emitAssistantBlocks(content []json.RawMessage, emit func(kind string, payload any)) {
	for _, raw := range content {
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
}

func emitToolResults(content []json.RawMessage, emit func(kind string, payload any)) {
	for _, raw := range content {
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
