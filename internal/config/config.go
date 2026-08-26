// Package config loads rapid-triage configuration from YAML with sane
// local-first defaults. All settings are optional except the Linear API key,
// which must come from the LINEAR_API_KEY environment variable.
package config

import (
	"fmt"
	"os"
	"path/filepath"
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

func Default() Config {
	home, _ := os.UserHomeDir()
	return Config{
		Addr:   "127.0.0.1:7333",
		DBPath: filepath.Join(home, ".rapid-triage", "triage.db"),
		Filter: map[string]any{
			"state": map[string]any{"type": map[string]any{"eq": "triage"}},
		},
		Sync: SyncConfig{Interval: 10 * time.Minute, PageSize: 50},
		AI:   AIConfig{Enabled: true, Command: "claude", Timeout: 3 * time.Minute},
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
	k := os.Getenv("LINEAR_API_KEY")
	if k == "" {
		return "", fmt.Errorf("LINEAR_API_KEY is not set; create a personal API key at linear.app → Settings → Security & access → API keys")
	}
	return k, nil
}
