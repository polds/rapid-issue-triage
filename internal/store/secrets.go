package store

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/polds/rapid-issue-triage/internal/config"
)

const metaSecrets = "secrets"

// Secrets are locally-persisted API credentials, set from the Settings page.
// They override matching environment variables when non-empty.
type Secrets struct {
	LinearAPIKey string `json:"linear_api_key,omitempty"`
	GitHubToken  string `json:"github_token,omitempty"`
	DDAPIKey     string `json:"dd_api_key,omitempty"`
	DDAppKey     string `json:"dd_app_key,omitempty"`
}

// SecretField is the public, non-secret view of one credential.
type SecretField struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Set    bool   `json:"set"`
	Source string `json:"source,omitempty"` // settings | env
	Hint   string `json:"hint,omitempty"`
}

var secretIDs = map[string]bool{
	"linear_api_key": true,
	"github_token":   true,
	"dd_api_key":     true,
	"dd_app_key":     true,
}

func (s *Store) GetSecrets() Secrets {
	var sec Secrets
	if raw, err := s.GetMeta(metaSecrets); err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), &sec)
	}
	return sec
}

func (s *Store) setSecrets(sec Secrets) error {
	b, err := json.Marshal(sec)
	if err != nil {
		return err
	}
	return s.SetMeta(metaSecrets, string(b))
}

// SetSecret stores or clears one credential. Empty value clears it.
func (s *Store) SetSecret(id, value string) error {
	if !secretIDs[id] {
		return fmt.Errorf("unknown secret %q", id)
	}
	sec := s.GetSecrets()
	value = strings.TrimSpace(value)
	switch id {
	case "linear_api_key":
		sec.LinearAPIKey = value
	case "github_token":
		sec.GitHubToken = value
	case "dd_api_key":
		sec.DDAPIKey = value
	case "dd_app_key":
		sec.DDAppKey = value
	}
	return s.setSecrets(sec)
}

// Resolve returns the stored value for a secret id, or empty.
func (s *Store) Resolve(id string) string {
	sec := s.GetSecrets()
	switch id {
	case "linear_api_key":
		return sec.LinearAPIKey
	case "github_token":
		return sec.GitHubToken
	case "dd_api_key":
		return sec.DDAPIKey
	case "dd_app_key":
		return sec.DDAppKey
	}
	return ""
}

// SecretStatus reports whether each source credential is set, without values.
func (s *Store) SecretStatus() map[string][]SecretField {
	sec := s.GetSecrets()
	return map[string][]SecretField{
		"linear": {field("linear_api_key", "Linear API key", sec.LinearAPIKey, "LINEAR_API_KEY")},
		"github": {field("github_token", "GitHub token", sec.GitHubToken, "GH_TOKEN", "GITHUB_TOKEN")},
		"datadog": {
			field("dd_api_key", "API key", sec.DDAPIKey, "DD_API_KEY"),
			field("dd_app_key", "Application key", sec.DDAppKey, "DD_APP_KEY"),
		},
	}
}

func field(id, label, stored string, envKeys ...string) SecretField {
	f := SecretField{ID: id, Label: label}
	if stored != "" {
		f.Set, f.Source, f.Hint = true, "settings", hint(stored)
		return f
	}
	for _, k := range envKeys {
		if v := config.Lookup(k); v != "" {
			f.Set, f.Source, f.Hint = true, "env", hint(v)
			return f
		}
	}
	return f
}

func hint(v string) string {
	if v == "" {
		return ""
	}
	if len(v) <= 4 {
		return "••••"
	}
	return "••••" + v[len(v)-4:]
}
