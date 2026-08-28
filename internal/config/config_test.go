package config

import (
	"os"
	"path/filepath"
	"testing"
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
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("RT_LOOKUP_TEST=from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Lookup("RT_LOOKUP_TEST"); got != "from-file" {
		t.Fatalf("dotenv: %q", got)
	}
}
