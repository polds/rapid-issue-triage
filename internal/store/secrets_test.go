package store

import (
	"path/filepath"
	"testing"
)

func TestSecretsRoundTripAndHint(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.SetSecret("dd_api_key", "abc123xyz999"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetSecret("unknown", "x"); err == nil {
		t.Fatal("expected unknown secret to fail")
	}
	if got := st.Resolve("dd_api_key"); got != "abc123xyz999" {
		t.Fatalf("resolve: %q", got)
	}
	status := st.SecretStatus()
	dd := status["datadog"]
	if len(dd) != 2 {
		t.Fatalf("datadog fields: %d", len(dd))
	}
	if !dd[0].Set || dd[0].Source != "settings" || dd[0].Hint != "••••z999" {
		t.Fatalf("api key field: %+v", dd[0])
	}
	if dd[1].Set {
		t.Fatalf("app key should be unset: %+v", dd[1])
	}

	t.Setenv("DD_APP_KEY", "envappkey")
	status = st.SecretStatus()
	if !status["datadog"][1].Set || status["datadog"][1].Source != "env" {
		t.Fatalf("env fallback: %+v", status["datadog"][1])
	}

	if err := st.SetSecret("dd_api_key", "  "); err != nil {
		t.Fatal(err)
	}
	if st.Resolve("dd_api_key") != "" {
		t.Fatal("clear failed")
	}
}

func TestHintMasks(t *testing.T) {
	if hint("ab") != "••••" {
		t.Fatalf("short: %q", hint("ab"))
	}
	if hint("token-1234") != "••••1234" {
		t.Fatalf("long: %q", hint("token-1234"))
	}
}
