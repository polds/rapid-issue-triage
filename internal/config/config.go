// Package config loads rapid-triage configuration from YAML with sane
// local-first defaults. All settings are optional except the Linear API key,
// which must come from the LINEAR_API_KEY environment variable.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	// Addr is the listen address for the local web UI.
	Addr string `yaml:"addr"`
	// DBPath is the sqlite database location.
	DBPath string `yaml:"db_path"`
	// Filter is a raw Linear GraphQL IssueFilter serialized as-is into the
	// issues query. Defaults to state type == triage.
	// Docs: https://developers.linear.app/docs/graphql/filtering
	Filter map[string]any `yaml:"filter"`
	Sync   SyncConfig     `yaml:"sync"`
	AI     AIConfig       `yaml:"ai"`
	Update UpdateConfig   `yaml:"update_check"`
}

type SyncConfig struct {
	// Interval between background refreshes.
	Interval time.Duration `yaml:"interval"`
	// PageSize for issue pagination.
	PageSize int `yaml:"page_size"`
}

type AIConfig struct {
	Enabled bool `yaml:"enabled"`
	// Command is the Claude Code binary to shell out to.
	Command string `yaml:"command"`
	// Model overrides the default model (passed as --model).
	Model string `yaml:"model"`
	// Timeout for a single enrichment run.
	Timeout time.Duration `yaml:"timeout"`
	// Prefetch enriches up to N upcoming queue items in the background.
	Prefetch int `yaml:"prefetch"`
}

// UpdateConfig controls the background "is there a newer release?" check.
// It is the one outbound call this app makes that is not to Linear or to the
// local claude binary, so it is switchable: `enabled: false` and nothing
// leaves the machine.
type UpdateConfig struct {
	Enabled bool `yaml:"enabled"`
	// Interval between checks. Floored at an hour.
	Interval time.Duration `yaml:"interval"`
	// Repo is the owner/name whose releases are compared against this build.
	Repo string `yaml:"repo"`
}

func Default() Config {
	home, _ := os.UserHomeDir()
	return Config{
		Addr:   "127.0.0.1:7333",
		DBPath: filepath.Join(home, ".rapid-triage", "triage.db"),
		// Workspaces without a Triage-type state (Linear's triage feature is
		// opt-in per team) triage straight from Backlog, so the default queue
		// covers both.
		Filter: map[string]any{
			"state": map[string]any{"type": map[string]any{"in": []any{"triage", "backlog"}}},
		},
		Sync:   SyncConfig{Interval: 10 * time.Minute, PageSize: 50},
		AI:     AIConfig{Enabled: true, Command: "claude", Timeout: 3 * time.Minute},
		Update: UpdateConfig{Enabled: true, Interval: 24 * time.Hour, Repo: "polds/rapid-issue-triage"},
	}
}

// Load reads the config file at path, or searches ./rapid-triage.yaml and
// ~/.config/rapid-triage/config.yaml when path is empty. A missing file is
// fine: defaults apply.
func Load(path string) (Config, error) {
	cfg := Default()
	candidates := []string{path}
	if path == "" {
		home, _ := os.UserHomeDir()
		candidates = []string{
			"rapid-triage.yaml",
			filepath.Join(home, ".config", "rapid-triage", "config.yaml"),
		}
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		b, err := os.ReadFile(c)
		if err != nil {
			if os.IsNotExist(err) && path == "" {
				continue
			}
			if path != "" {
				return cfg, fmt.Errorf("read config %s: %w", c, err)
			}
			continue
		}
		if err := yaml.Unmarshal(b, &cfg); err != nil {
			return cfg, fmt.Errorf("parse config %s: %w", c, err)
		}
		break
	}
	if cfg.Sync.PageSize <= 0 || cfg.Sync.PageSize > 250 {
		cfg.Sync.PageSize = 50
	}
	return cfg, nil
}

func (c Config) APIKey() (string, error) {
	if k := Lookup("LINEAR_API_KEY"); k != "" {
		return k, nil
	}
	return "", fmt.Errorf("LINEAR_API_KEY is not set (env, .env, or Settings); create a personal API key at linear.app → Settings → Security & access → API keys")
}

// Lookup returns KEY from the process environment, then ./.env, then
// ~/.rapid-triage/.env. Empty string if unset everywhere.
func Lookup(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{".env", filepath.Join(home, ".rapid-triage", ".env")} {
		if v := envFileValue(p, key); v != "" {
			return v
		}
	}
	return ""
}

// ExpandHome resolves a leading ~/ to the current user's home directory.
func ExpandHome(p string) string {
	if p == "~" {
		home, _ := os.UserHomeDir()
		return home
	}
	if strings.HasPrefix(p, "~/") {
		home, _ := os.UserHomeDir()
		return home + p[1:]
	}
	return p
}

// envFileValue reads KEY=value lines from a dotenv-style file. Comments and
// optional surrounding quotes are handled; anything else is ignored.
func envFileValue(path, key string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for line := range strings.SplitSeq(string(b), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "export "))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(k) != key {
			continue
		}
		v = strings.TrimSpace(v)
		v = strings.Trim(v, `"'`)
		return v
	}
	return ""
}
