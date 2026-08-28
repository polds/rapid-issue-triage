package server

import "testing"

func TestLinearIssueURL(t *testing.T) {
	from := "https://linear.app/atumlabs/issue/CORE-1234/some-slug"
	got := linearIssueURL("CORE-1834", from, "")
	want := "https://linear.app/atumlabs/issue/CORE-1834"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if got := linearIssueURL("CORE-1", from, "https://linear.app/x/issue/CORE-1"); got != "https://linear.app/x/issue/CORE-1" {
		t.Fatalf("explicit: %q", got)
	}
	if linearIssueURL("CORE-1", "", "") != "" {
		t.Fatal("empty template should yield empty")
	}
}
