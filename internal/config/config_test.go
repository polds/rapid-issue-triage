package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExpandHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if got := ExpandHome("~/src"); got != home+"/src" {
		t.Fatalf("got %q", got)
	}
	if got := ExpandHome("~"); got != home {
		t.Fatalf("~: %q", got)
	}
	if got := ExpandHome("/abs/path"); got != "/abs/path" {
		t.Fatalf("abs: %q", got)
	}
}

func TestLookupEnvThenDotenv(t *testing.T) {
	t.Setenv("RT_LOOKUP_TEST", "from-env")
	if got := Lookup("RT_LOOKUP_TEST"); got != "from-env" {
		t.Fatalf("env: %q", got)
	}
	t.Setenv("RT_LOOKUP_TEST", "")
	dir := t.TempDir()
	t.Chdir(dir)
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("RT_LOOKUP_TEST=from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Lookup("RT_LOOKUP_TEST"); got != "from-file" {
		t.Fatalf("dotenv: %q", got)
	}
}

func TestEnvFileValueQuotesExportAndComments(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	content := "# comment\nexport QUOTED=\"hello world\"\nNAKED=bare\nWRONG=nope\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := envFileValue(path, "QUOTED"); got != "hello world" {
		t.Fatalf("quoted: %q", got)
	}
	if got := envFileValue(path, "NAKED"); got != "bare" {
		t.Fatalf("naked: %q", got)
	}
	if got := envFileValue(path, "MISSING"); got != "" {
		t.Fatalf("missing: %q", got)
	}
	if got := envFileValue(filepath.Join(dir, "nope"), "X"); got != "" {
		t.Fatalf("absent file: %q", got)
	}
}

func TestLoadYAMLAndPageSizeClamp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rapid-triage.yaml")
	yaml := "addr: 127.0.0.1:9999\nsync:\n  page_size: 999\n  interval: 2m\nai:\n  enabled: false\n  command: /bin/claude\n"
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:9999" {
		t.Fatalf("addr: %q", cfg.Addr)
	}
	if cfg.Sync.PageSize != 50 {
		t.Fatalf("page size should clamp: %d", cfg.Sync.PageSize)
	}
	if cfg.AI.Enabled {
		t.Fatal("ai.enabled should be false")
	}
	if cfg.AI.Command != "/bin/claude" {
		t.Fatalf("command: %q", cfg.AI.Command)
	}

	small := filepath.Join(dir, "small.yaml")
	if err := os.WriteFile(small, []byte("sync:\n  page_size: 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load(small)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Sync.PageSize != 50 {
		t.Fatalf("zero page size: %d", cfg.Sync.PageSize)
	}

	ok := filepath.Join(dir, "ok.yaml")
	if err := os.WriteFile(ok, []byte("sync:\n  page_size: 100\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load(ok)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Sync.PageSize != 100 {
		t.Fatalf("page size: %d", cfg.Sync.PageSize)
	}

	if _, err := Load(filepath.Join(dir, "missing.yaml")); err == nil {
		t.Fatal("expected missing explicit path to fail")
	}
	if _, err := Load(path + "/not-a-file"); err == nil {
		t.Fatal("expected unreadable path to fail")
	}

	bad := filepath.Join(dir, "bad.yaml")
	if err := os.WriteFile(bad, []byte("addr: [\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(bad); err == nil {
		t.Fatal("expected parse error")
	}
}

func TestLoadEmptyPathUsesDefaults(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	cfg, err := Load("")
	if err != nil {
		t.Fatal(err)
	}
	def := Default()
	if cfg.Addr != def.Addr {
		t.Fatalf("addr: %q", cfg.Addr)
	}
}

func TestAPIKey(t *testing.T) {
	t.Setenv("LINEAR_API_KEY", "")
	dir := t.TempDir()
	t.Chdir(dir)
	cfg := Default()
	if _, err := cfg.APIKey(); err == nil {
		t.Fatal("expected missing key error")
	}
	t.Setenv("LINEAR_API_KEY", "lin_api_test")
	got, err := cfg.APIKey()
	if err != nil {
		t.Fatal(err)
	}
	if got != "lin_api_test" {
		t.Fatalf("key: %q", got)
	}
}

// The update check defaults on, and `enabled: false` must actually turn it
// off — that switch is the only thing standing between an offline user and an
// outbound request.
func TestLoadUpdateCheck(t *testing.T) {
	def := Default()
	if !def.Update.Enabled || def.Update.Interval != 24*time.Hour || def.Update.Repo == "" {
		t.Fatalf("default update config: %+v", def.Update)
	}

	dir := t.TempDir()
	off := filepath.Join(dir, "off.yaml")
	if err := os.WriteFile(off, []byte("update_check:\n  enabled: false\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(off)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Update.Enabled {
		t.Fatal("update_check.enabled: false did not disable the check")
	}
	if cfg.Update.Repo != def.Update.Repo {
		t.Fatalf("repo should keep its default: %q", cfg.Update.Repo)
	}

	custom := filepath.Join(dir, "custom.yaml")
	body := "update_check:\n  enabled: true\n  interval: 6h\n  repo: octocat/Hello-World\n"
	if err := os.WriteFile(custom, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load(custom)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Update.Enabled || cfg.Update.Interval != 6*time.Hour || cfg.Update.Repo != "octocat/Hello-World" {
		t.Fatalf("update config: %+v", cfg.Update)
	}
}
